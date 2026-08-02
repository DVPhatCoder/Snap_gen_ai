/**
 * Tự Add Voice Library sang account/API key (failover / Add bằng Voice ID).
 * POST /v1/voices/add/{public_owner_id}/{voice_id} → voice_id mới trên account đó.
 */

export type VoiceShareMeta = {
  publicOwnerId: string;
  /** ID trên Voice Library (original). */
  libraryVoiceId: string;
  name: string;
};

/** Cache: keyId + libraryVoiceId → voiceId trên account đó (trong 1 process). */
const voiceIdByKey = new Map<string, string>();

function cacheKey(apiKeyId: string, libraryVoiceId: string): string {
  return `${apiKeyId}::${libraryVoiceId}`;
}

export function rememberVoiceOnKey(
  apiKeyId: string,
  libraryVoiceId: string,
  accountVoiceId: string
): void {
  voiceIdByKey.set(cacheKey(apiKeyId, libraryVoiceId), accountVoiceId);
}

export function recallVoiceOnKey(
  apiKeyId: string,
  libraryVoiceId: string
): string | undefined {
  return voiceIdByKey.get(cacheKey(apiKeyId, libraryVoiceId));
}

async function fetchWithKey(
  apiKey: string,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'xi-api-key': apiKey,
  };
  if (init.headers) {
    const extra =
      init.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : Array.isArray(init.headers)
          ? Object.fromEntries(init.headers)
          : { ...(init.headers as Record<string, string>) };
    Object.assign(headers, extra);
    headers['xi-api-key'] = apiKey;
  }
  return fetch(url, { ...init, headers });
}

function detailText(data: unknown): string {
  if (!data || typeof data !== 'object') return String(data || '');
  const d = data as { detail?: { message?: string } | string };
  if (typeof d.detail === 'string') return d.detail;
  if (d.detail && typeof d.detail === 'object' && d.detail.message) return d.detail.message;
  return JSON.stringify(data).slice(0, 280);
}

/** Lấy sharing meta từ voice đã có trên account (GET /v1/voices/{id}). */
export async function fetchVoiceShareMeta(
  apiKey: string,
  voiceId: string
): Promise<VoiceShareMeta | null> {
  const res = await fetchWithKey(
    apiKey,
    `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`
  );
  const data = (await res.json()) as {
    name?: string;
    voice_id?: string;
    sharing?: {
      public_owner_id?: string;
      original_voice_id?: string;
    };
  };
  if (!res.ok) return null;
  const publicOwnerId = data.sharing?.public_owner_id?.trim();
  if (!publicOwnerId) return null;
  return {
    publicOwnerId,
    libraryVoiceId: data.sharing?.original_voice_id?.trim() || data.voice_id || voiceId,
    name: data.name?.trim() || 'SnapGen Voice',
  };
}

/** Tìm trên Voice Library theo voice_id hoặc tên. */
export async function searchLibraryShareMeta(
  apiKey: string,
  options: { voiceId?: string; name?: string }
): Promise<VoiceShareMeta | null> {
  const voiceId = options.voiceId?.trim();
  const search = (options.name || voiceId || '').trim();
  if (!search) return null;

  const trySearch = async (term: string): Promise<VoiceShareMeta | null> => {
    const url = new URL('https://api.elevenlabs.io/v1/shared-voices');
    url.searchParams.set('page_size', '100');
    url.searchParams.set('search', term);

    const res = await fetchWithKey(apiKey, url.toString());
    const data = (await res.json()) as {
      voices?: Array<{
        public_owner_id?: string;
        voice_id?: string;
        name?: string;
      }>;
    };
    if (!res.ok) return null;

    const list = data.voices || [];
    if (voiceId) {
      const byId = list.find((v) => v.voice_id === voiceId);
      if (byId?.public_owner_id && byId.voice_id) {
        return {
          publicOwnerId: byId.public_owner_id,
          libraryVoiceId: byId.voice_id,
          name: byId.name || term,
        };
      }
    }
    const byName = list.find((v) => (v.name || '').toLowerCase() === term.toLowerCase());
    const hit = byName || list[0];
    if (!hit?.public_owner_id || !hit.voice_id) return null;
    return {
      publicOwnerId: hit.public_owner_id,
      libraryVoiceId: hit.voice_id,
      name: hit.name || term,
    };
  };

  if (voiceId) {
    const byId = await trySearch(voiceId);
    if (byId && byId.libraryVoiceId === voiceId) return byId;
  }
  if (options.name?.trim()) {
    const byName = await trySearch(options.name.trim());
    if (byName) return byName;
  }
  return voiceId ? trySearch(voiceId) : null;
}

/** Lấy voiceId từ URL Voice Library hoặc chuỗi thô. */
export function parseElevenLabsLibraryVoiceInput(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  try {
    if (/^https?:\/\//i.test(text)) {
      const u = new URL(text);
      const fromQuery =
        u.searchParams.get('voiceId') ||
        u.searchParams.get('voice_id') ||
        u.searchParams.get('id');
      if (fromQuery?.trim()) return fromQuery.trim();
      const pathHit = u.pathname.match(/\/voices?\/([A-Za-z0-9_-]+)/i);
      if (pathHit?.[1]) return pathHit[1];
    }
  } catch {
    /* ignore */
  }
  if (text.includes('/') && !/\s/.test(text)) {
    const parts = text.split('/').filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 1];
  }
  return text.replace(/^voice[_-]?id[=:\s]+/i, '').trim();
}

/**
 * Add shared voice vào account của apiKey.
 * Trả về voice_id mới trên account đó (có thể khác ID ban đầu).
 */
export async function addSharedVoiceToApiKey(
  apiKey: string,
  meta: VoiceShareMeta
): Promise<{ voiceId: string } | { error: string; status: number }> {
  const url = `https://api.elevenlabs.io/v1/voices/add/${encodeURIComponent(meta.publicOwnerId)}/${encodeURIComponent(meta.libraryVoiceId)}`;
  const res = await fetchWithKey(apiKey, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: meta.name.slice(0, 100) || 'SnapGen Voice' }),
  });
  const data = (await res.json()) as { voice_id?: string; detail?: unknown };
  if (res.ok && data.voice_id) {
    return { voiceId: data.voice_id };
  }

  if (res.status === 400 || res.status === 409 || /already|exist/i.test(detailText(data))) {
    const found = await findAccountVoiceId(apiKey, meta);
    if (found) return { voiceId: found };
  }

  return { error: detailText(data), status: res.status };
}

async function findAccountVoiceId(
  apiKey: string,
  meta: VoiceShareMeta
): Promise<string | null> {
  const res = await fetchWithKey(apiKey, 'https://api.elevenlabs.io/v1/voices');
  const data = (await res.json()) as {
    voices?: Array<{
      voice_id?: string;
      name?: string;
      sharing?: { original_voice_id?: string; public_owner_id?: string };
    }>;
  };
  if (!res.ok) return null;
  const voices = data.voices || [];
  const byOriginal = voices.find(
    (v) => v.sharing?.original_voice_id === meta.libraryVoiceId
  );
  if (byOriginal?.voice_id) return byOriginal.voice_id;
  const byName = voices.find(
    (v) => (v.name || '').toLowerCase() === meta.name.toLowerCase()
  );
  if (byName?.voice_id) return byName.voice_id;
  const byId = voices.find((v) => v.voice_id === meta.libraryVoiceId);
  return byId?.voice_id || null;
}

/**
 * Đảm bảo giọng Library có trên account của key.
 * Premade / đã có sẵn → trả về voiceId hiện tại.
 */
export async function ensureLibraryVoiceOnApiKey(options: {
  apiKey: string;
  apiKeyId: string;
  selectedVoiceId: string;
  meta?: Partial<VoiceShareMeta> | null;
}): Promise<{ voiceId: string; added: boolean; meta: VoiceShareMeta | null }> {
  const selected = options.selectedVoiceId.trim();
  const libraryId = options.meta?.libraryVoiceId?.trim() || selected;

  const cached = recallVoiceOnKey(options.apiKeyId, libraryId);
  if (cached) {
    return {
      voiceId: cached,
      added: false,
      meta: options.meta?.publicOwnerId
        ? {
            publicOwnerId: options.meta.publicOwnerId,
            libraryVoiceId: libraryId,
            name: options.meta.name || 'SnapGen Voice',
          }
        : null,
    };
  }

  const existing = await findAccountVoiceId(options.apiKey, {
    publicOwnerId: options.meta?.publicOwnerId || '',
    libraryVoiceId: libraryId,
    name: options.meta?.name || '',
  });
  if (existing) {
    rememberVoiceOnKey(options.apiKeyId, libraryId, existing);
    return {
      voiceId: existing,
      added: false,
      meta: options.meta?.publicOwnerId
        ? {
            publicOwnerId: options.meta.publicOwnerId,
            libraryVoiceId: libraryId,
            name: options.meta.name || 'SnapGen Voice',
          }
        : null,
    };
  }

  let meta: VoiceShareMeta | null = options.meta?.publicOwnerId
    ? {
        publicOwnerId: options.meta.publicOwnerId,
        libraryVoiceId: libraryId,
        name: options.meta.name || 'SnapGen Voice',
      }
    : null;

  if (!meta) {
    meta =
      (await fetchVoiceShareMeta(options.apiKey, selected)) ||
      (await searchLibraryShareMeta(options.apiKey, {
        voiceId: libraryId,
        name: options.meta?.name,
      }));
  }

  if (!meta?.publicOwnerId) {
    rememberVoiceOnKey(options.apiKeyId, libraryId, selected);
    return { voiceId: selected, added: false, meta: null };
  }

  const added = await addSharedVoiceToApiKey(options.apiKey, meta);
  if ('voiceId' in added) {
    rememberVoiceOnKey(options.apiKeyId, meta.libraryVoiceId, added.voiceId);
    return { voiceId: added.voiceId, added: true, meta };
  }

  throw new Error(
    `Không Add được giọng «${meta.name}» sang API key mới (HTTP ${added.status}): ${added.error}. ` +
      `Kiểm tra slot custom voice / gói ElevenLabs của key đó.`
  );
}

/**
 * Add cùng giọng Library sang mọi API key (account khác).
 */
export async function ensureLibraryVoiceOnAllApiKeys(options: {
  keys: Array<{ id: string; apiKey: string }>;
  selectedVoiceId: string;
  meta: VoiceShareMeta;
}): Promise<{ synced: number; failed: string[] }> {
  const failed: string[] = [];
  let synced = 0;
  for (const key of options.keys) {
    try {
      await ensureLibraryVoiceOnApiKey({
        apiKey: key.apiKey,
        apiKeyId: key.id,
        selectedVoiceId: options.selectedVoiceId,
        meta: options.meta,
      });
      synced += 1;
    } catch (err) {
      failed.push(
        `${key.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 120)
      );
    }
  }
  return { synced, failed };
}

/**
 * Add Voice Library chỉ bằng voiceId (hoặc URL) — không cần lên web bấm Add.
 * Đồng bộ sang mọi API key đang bật.
 */
export async function addLibraryVoiceByIdOrUrl(options: {
  input: string;
  newName?: string;
  keys: Array<{ id: string; apiKey: string }>;
}): Promise<{
  voiceId: string;
  libraryVoiceId: string;
  publicOwnerId: string;
  name: string;
  syncedKeys: number;
  voicesHint: string;
}> {
  const libraryVoiceId = parseElevenLabsLibraryVoiceInput(options.input);
  if (!libraryVoiceId || libraryVoiceId.length < 8) {
    throw new Error(
      'Voice ID không hợp lệ. Dán ID (vd. j210dv0vWm7fCknyQpbA) hoặc URL Voice Library.'
    );
  }
  if (!options.keys.length) {
    throw new Error('Chưa có API key ElevenLabs. Thêm key trong Settings trước.');
  }

  const primary = options.keys[0];
  let meta = await searchLibraryShareMeta(primary.apiKey, { voiceId: libraryVoiceId });

  if (!meta && options.input.includes('/')) {
    const parts = options.input
      .trim()
      .replace(/^https?:\/\/[^/?#]+/i, '')
      .split(/[/?#]/)
      .filter(Boolean);
    // ownerId/voiceId thô
    const slashParts = options.input.trim().split('/').filter(Boolean);
    if (slashParts.length >= 2 && !/^https?:/i.test(options.input.trim())) {
      meta = {
        publicOwnerId: slashParts[slashParts.length - 2],
        libraryVoiceId: slashParts[slashParts.length - 1],
        name: options.newName?.trim() || 'SnapGen Voice',
      };
    } else if (parts.length >= 2) {
      void parts;
    }
  }

  if (!meta?.publicOwnerId) {
    throw new Error(
      `Không tìm thấy giọng Library «${libraryVoiceId}» trên ElevenLabs. ` +
        `Kiểm tra ID/URL, hoặc dán dạng publicOwnerId/voiceId.`
    );
  }

  if (options.newName?.trim()) {
    meta = { ...meta, name: options.newName.trim() };
  }

  const ensured = await ensureLibraryVoiceOnApiKey({
    apiKey: primary.apiKey,
    apiKeyId: primary.id,
    selectedVoiceId: meta.libraryVoiceId,
    meta,
  });

  const sync = await ensureLibraryVoiceOnAllApiKeys({
    keys: options.keys,
    selectedVoiceId: ensured.voiceId,
    meta,
  });

  return {
    voiceId: ensured.voiceId,
    libraryVoiceId: meta.libraryVoiceId,
    publicOwnerId: meta.publicOwnerId,
    name: meta.name,
    syncedKeys: sync.synced,
    voicesHint:
      sync.failed.length > 0
        ? `Đã Add «${meta.name}». Sync ${sync.synced} key; một số key lỗi: ${sync.failed[0]}`
        : `Đã Add «${meta.name}» và sync sang ${sync.synced} API key.`,
  };
}

export { fetchWithKey as elevenLabsFetchWithKey };
