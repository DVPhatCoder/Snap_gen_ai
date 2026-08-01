/**
 * Tự Add Voice Library sang account/API key mới (failover hết token).
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
  const search = (options.name || options.voiceId || '').trim();
  if (!search) return null;

  const url = new URL('https://api.elevenlabs.io/v1/shared-voices');
  url.searchParams.set('page_size', '30');
  url.searchParams.set('search', search);

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
  const byId = options.voiceId
    ? list.find((v) => v.voice_id === options.voiceId)
    : undefined;
  const hit =
    byId ||
    list.find((v) => (v.name || '').toLowerCase() === search.toLowerCase()) ||
    list[0];
  if (!hit?.public_owner_id || !hit.voice_id) return null;
  return {
    publicOwnerId: hit.public_owner_id,
    libraryVoiceId: hit.voice_id,
    name: hit.name || search,
  };
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

  // Đã Add rồi → tìm trong danh sách voice của account.
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
  const libraryId =
    options.meta?.libraryVoiceId?.trim() || selected;

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

  // Đã có sẵn trên account?
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
    // Không có meta Library → dùng thẳng ID (premade / cùng account).
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

export { fetchWithKey as elevenLabsFetchWithKey };
