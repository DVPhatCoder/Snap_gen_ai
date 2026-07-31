import { getKeys } from '../store';
import { elevenLabsFetch, getElevenLabsSessionStatus } from './elevenlabs-auth';
import type {
  ProviderQuota,
  ProviderUsageHistory,
  UsageHistoryItem,
  UsageHistorySnapshot,
  UsageSnapshot,
} from '../../shared/types';

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function truncate(text: string, max = 72): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

async function fetchSnapgenQuota(apiKey: string): Promise<ProviderQuota> {
  if (!apiKey.trim()) {
    return {
      id: 'snapgen',
      label: 'Snapgen',
      ok: false,
      message: 'Chưa có Snapgen API key.',
    };
  }

  try {
    const res = await fetch('https://api.snapgen.ai/uapi/v1/account', {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = (JSON.parse(text) as Record<string, unknown>) || {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      return {
        id: 'snapgen',
        label: 'Snapgen',
        ok: false,
        message: `HTTP ${res.status}: ${text.slice(0, 160)}`,
      };
    }

    const userCredit = asRecord(data.user_credit);
    const remaining = userCredit
      ? pickNumber(userCredit, ['available_credit', 'credit', 'credits'])
      : undefined;
    const locked = userCredit
      ? pickNumber(userCredit, ['locked_credit', 'locked_credits'])
      : undefined;
    const email = pickString(data, ['email', 'full_name', 'username', 'name']);
    const plan = pickString(data, ['plan_id', 'plan', 'tier']);

    if (remaining == null) {
      return {
        id: 'snapgen',
        label: 'Snapgen',
        ok: true,
        message: email
          ? `Tài khoản OK (${email}) — không đọc được credit.`
          : 'API key hợp lệ — không đọc được credit từ /account.',
        plan,
      };
    }

    return {
      id: 'snapgen',
      label: 'Snapgen',
      ok: true,
      message: 'Đã lấy số dư Snapgen.',
      remaining,
      unit: 'credit',
      plan,
      detail:
        [
          email,
          locked != null && locked > 0 ? `locked ${locked.toLocaleString('vi-VN')}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
    };
  } catch (err) {
    return {
      id: 'snapgen',
      label: 'Snapgen',
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchElevenLabsQuota(): Promise<ProviderQuota> {
  const session = await getElevenLabsSessionStatus();
  if (!session.loggedIn && !session.hasApiCredential) {
    return {
      id: 'elevenlabs',
      label: 'ElevenLabs',
      ok: false,
      message: 'Chưa có API key ElevenLabs.',
    };
  }

  try {
    const res = await elevenLabsFetch('https://api.elevenlabs.io/v1/user/subscription');
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = (JSON.parse(text) as Record<string, unknown>) || {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      return {
        id: 'elevenlabs',
        label: 'ElevenLabs',
        ok: false,
        message: `HTTP ${res.status}: ${text.slice(0, 160)}`,
      };
    }

    const used = pickNumber(data, ['character_count']);
    const limit = pickNumber(data, ['character_limit']);
    const remaining =
      used != null && limit != null ? Math.max(0, limit - used) : undefined;
    const plan = pickString(data, ['tier', 'status']);
    const resetUnix = pickNumber(data, ['next_character_count_reset_unix']);
    const resetAt =
      resetUnix != null ? new Date(resetUnix * 1000).toISOString() : undefined;

    return {
      id: 'elevenlabs',
      label: 'ElevenLabs',
      ok: true,
      message: 'Đã lấy quota ký tự ElevenLabs.',
      remaining,
      used,
      limit,
      unit: 'character',
      plan: plan || session.email,
      resetAt,
      detail: session.email,
    };
  } catch (err) {
    return {
      id: 'elevenlabs',
      label: 'ElevenLabs',
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Chỉ Snapgen + ElevenLabs — OpenAI secret key không xem được số dư nên không hiển thị. */
export async function getUsageSnapshot(): Promise<UsageSnapshot> {
  const keys = getKeys();
  const [snapgen, elevenlabs] = await Promise.all([
    fetchSnapgenQuota(keys.snapgenApiKey),
    fetchElevenLabsQuota(),
  ]);

  return {
    updatedAt: new Date().toISOString(),
    providers: [snapgen, elevenlabs],
  };
}

async function fetchSnapgenHistory(
  apiKey: string,
  page = 1,
  pageSize = 20
): Promise<ProviderUsageHistory> {
  if (!apiKey.trim()) {
    return {
      provider: 'snapgen',
      label: 'Snapgen',
      ok: false,
      message: 'Chưa có Snapgen API key.',
      totalAmount: 0,
      unit: 'credit',
      items: [],
      hasMore: false,
    };
  }

  try {
    const url = new URL('https://api.snapgen.ai/uapi/v1/histories');
    url.searchParams.set('filter_by', 'all');
    url.searchParams.set('items_per_page', String(pageSize));
    url.searchParams.set('page', String(page));
    const res = await fetch(url, {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = (JSON.parse(text) as Record<string, unknown>) || {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      return {
        provider: 'snapgen',
        label: 'Snapgen',
        ok: false,
        message: `HTTP ${res.status}: ${text.slice(0, 160)}`,
        totalAmount: 0,
        unit: 'credit',
        items: [],
        hasMore: false,
      };
    }

    const rows = asArray(data.result);
    const totalCount = pickNumber(data, ['total']);
    const items: UsageHistoryItem[] = [];
    for (const row of rows) {
      const rec = asRecord(row);
      if (!rec) continue;
      const amount = pickNumber(rec, ['used_credit', 'estimated_credit', 'credit']) ?? 0;
      const id =
        pickString(rec, ['uuid', 'id']) ||
        String(pickNumber(rec, ['id']) ?? items.length);
      const model = pickString(rec, ['model_name', 'name']) || 'generation';
      const type = pickString(rec, ['type']) || '';
      const statusRaw = pickString(rec, ['status_desc']);
      const statusNum = pickNumber(rec, ['status']);
      const status =
        statusRaw ||
        (statusNum === 2
          ? 'COMPLETED'
          : statusNum === 1
            ? 'PROCESSING'
            : statusNum === 0
              ? 'PENDING'
              : statusNum === 3
                ? 'FAILED'
                : statusNum != null
                  ? String(statusNum)
                  : undefined);
      const prompt = pickString(rec, ['input_text', 'custom_prompt', 'name']);
      const created =
        pickString(rec, ['created_at', 'updated_at']) || new Date().toISOString();
      items.push({
        id: `snapgen-${id}`,
        provider: 'snapgen',
        title: type ? `${model} · ${type}` : model,
        detail: prompt ? truncate(prompt) : undefined,
        amount,
        unit: 'credit',
        status,
        createdAt: created.includes('T') ? created : `${created.replace(' ', 'T')}Z`,
      });
    }

    const loadedThrough = (page - 1) * pageSize + items.length;
    const hasMore =
      items.length >= pageSize &&
      (totalCount == null ? true : loadedThrough < totalCount);

    const totalAmount = items.reduce((sum, item) => sum + (item.amount || 0), 0);
    return {
      provider: 'snapgen',
      label: 'Snapgen',
      ok: true,
      message: items.length
        ? `${items.length} lần gen · ${totalAmount.toLocaleString('vi-VN')} credit`
        : 'Chưa có lịch sử generation.',
      totalAmount,
      unit: 'credit',
      items,
      hasMore,
      nextPage: hasMore ? page + 1 : undefined,
      totalCount,
    };
  } catch (err) {
    return {
      provider: 'snapgen',
      label: 'Snapgen',
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      totalAmount: 0,
      unit: 'credit',
      items: [],
      hasMore: false,
    };
  }
}

async function fetchElevenLabsHistory(
  cursor?: string,
  pageSize = 20
): Promise<ProviderUsageHistory> {
  const session = await getElevenLabsSessionStatus();
  if (!session.loggedIn && !session.hasApiCredential) {
    return {
      provider: 'elevenlabs',
      label: 'ElevenLabs',
      ok: false,
      message: 'Chưa có API key ElevenLabs.',
      totalAmount: 0,
      unit: 'character',
      items: [],
      hasMore: false,
    };
  }

  try {
    const url = new URL('https://api.elevenlabs.io/v1/history');
    url.searchParams.set('page_size', String(pageSize));
    if (cursor) url.searchParams.set('start_after_history_item_id', cursor);
    const res = await elevenLabsFetch(url.toString());
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = (JSON.parse(text) as Record<string, unknown>) || {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      return {
        provider: 'elevenlabs',
        label: 'ElevenLabs',
        ok: false,
        message: `HTTP ${res.status}: ${text.slice(0, 160)}`,
        totalAmount: 0,
        unit: 'character',
        items: [],
        hasMore: false,
      };
    }

    const rows = asArray(data.history);
    const items: UsageHistoryItem[] = [];
    let lastRawId: string | undefined;
    for (const row of rows) {
      const rec = asRecord(row);
      if (!rec) continue;
      const from = pickNumber(rec, ['character_count_change_from']) ?? 0;
      const to = pickNumber(rec, ['character_count_change_to']) ?? from;
      const amount = Math.max(0, to - from);
      const rawId = pickString(rec, ['history_item_id', 'request_id']) || String(items.length);
      lastRawId = pickString(rec, ['history_item_id']) || lastRawId;
      const voice = pickString(rec, ['voice_name']) || 'voice';
      const model = pickString(rec, ['model_id']) || '';
      const source = pickString(rec, ['source']) || 'TTS';
      const textBody = pickString(rec, ['text']);
      const unix = pickNumber(rec, ['date_unix']);
      const createdAt =
        unix != null
          ? new Date(unix * 1000).toISOString()
          : new Date().toISOString();
      items.push({
        id: `elevenlabs-${rawId}`,
        provider: 'elevenlabs',
        title: model ? `${voice} · ${model}` : `${voice} · ${source}`,
        detail: textBody ? truncate(textBody) : source,
        amount,
        unit: 'character',
        status: pickString(rec, ['state']) || source,
        createdAt,
      });
    }

    const hasMore =
      data.has_more === true
        ? Boolean(lastRawId)
        : data.has_more === false
          ? false
          : items.length >= pageSize && Boolean(lastRawId);

    const totalAmount = items.reduce((sum, item) => sum + (item.amount || 0), 0);
    return {
      provider: 'elevenlabs',
      label: 'ElevenLabs',
      ok: true,
      message: items.length
        ? `${items.length} lần TTS · ${totalAmount.toLocaleString('vi-VN')} ký tự`
        : 'Chưa có lịch sử TTS.',
      totalAmount,
      unit: 'character',
      items,
      hasMore,
      nextCursor: hasMore ? lastRawId : undefined,
    };
  } catch (err) {
    return {
      provider: 'elevenlabs',
      label: 'ElevenLabs',
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      totalAmount: 0,
      unit: 'character',
      items: [],
      hasMore: false,
    };
  }
}

export async function getUsageHistory(): Promise<UsageHistorySnapshot> {
  const keys = getKeys();
  // Chỉ load Snapgen trước (ưu tiên) — ElevenLabs tải khi đổi filter / kéo.
  const snapgen = await fetchSnapgenHistory(keys.snapgenApiKey, 1, 12);

  return {
    updatedAt: new Date().toISOString(),
    providers: [
      snapgen,
      {
        provider: 'elevenlabs',
        label: 'ElevenLabs',
        ok: true,
        message: 'Chưa tải — chọn tab ElevenLabs hoặc kéo trong Tất cả.',
        totalAmount: 0,
        unit: 'character',
        items: [],
        hasMore: true,
        nextCursor: undefined,
      },
    ],
  };
}

export async function loadMoreUsageHistory(request: {
  provider: 'snapgen' | 'elevenlabs';
  page?: number;
  cursor?: string;
}): Promise<import('../../shared/types').LoadMoreUsageHistoryResult> {
  const keys = getKeys();
  if (request.provider === 'snapgen') {
    const page = Math.max(request.page ?? 2, 2);
    const block = await fetchSnapgenHistory(keys.snapgenApiKey, page, 12);
    return {
      provider: 'snapgen',
      ok: block.ok,
      message: block.message,
      items: block.items,
      hasMore: !!block.hasMore,
      nextPage: block.nextPage,
      totalCount: block.totalCount,
    };
  }

  // page/cursor undefined = trang đầu ElevenLabs
  const block = await fetchElevenLabsHistory(request.cursor, 12);
  return {
    provider: 'elevenlabs',
    ok: block.ok,
    message: block.message,
    items: block.items,
    hasMore: !!block.hasMore,
    nextCursor: block.nextCursor,
  };
}
