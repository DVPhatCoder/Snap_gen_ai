import type { ProviderApiKeyPublic, ProviderApiKeyRecord } from '../../../shared/provider-api-keys';
import {
  deleteElevenLabsKey,
  hasAnyElevenLabsApiKey,
  listElevenLabsKeysPublic,
  loadElevenLabsKeyRecords,
  markElevenLabsKeyStatus,
  moveElevenLabsKey,
  pickNextAvailableRecord,
  RATE_LIMIT_COOLDOWN_MS,
  resetElevenLabsKeyStatus,
  updateElevenLabsKey,
  upsertElevenLabsKey,
} from './elevenlabs-keys-store';

export type FailoverClass = 'failover' | 'retry_same' | 'fatal';

/**
 * ElevenLabsKeyManager — chọn key, failover, cooldown, status.
 * TTS / usage chỉ gọi getAvailableKey + report qua classifyHttpError.
 */
export class ElevenLabsKeyManager {
  static listPublic(): ProviderApiKeyPublic[] {
    return listElevenLabsKeysPublic();
  }

  static hasKeys(): boolean {
    return hasAnyElevenLabsApiKey();
  }

  static addKey(apiKey: string, name?: string): ProviderApiKeyPublic {
    const saved = upsertElevenLabsKey(apiKey, name);
    const list = listElevenLabsKeysPublic();
    return list.find((k) => k.id === saved.id) || list[0];
  }

  static async getAvailableKey(excludeIds?: Set<string>): Promise<ProviderApiKeyRecord | null> {
    return pickNextAvailableRecord(undefined, excludeIds);
  }

  static markBusy(id: string): void {
    markElevenLabsKeyStatus(id, 'busy');
  }

  static markActive(id: string): void {
    markElevenLabsKeyStatus(id, 'active', { touch: true });
  }

  static markReady(id: string): void {
    markElevenLabsKeyStatus(id, 'ready');
  }

  static markSuccess(id: string): void {
    markElevenLabsKeyStatus(id, 'ready', { touch: true });
  }

  static markExhausted(id: string): void {
    markElevenLabsKeyStatus(id, 'exhausted');
  }

  static markInvalid(id: string): void {
    markElevenLabsKeyStatus(id, 'invalid');
  }

  static markRateLimited(id: string, cooldownMs = RATE_LIMIT_COOLDOWN_MS): void {
    markElevenLabsKeyStatus(id, 'rate_limited', { cooldownMs });
  }

  static applyHttpFailure(id: string, status: number, body: string): FailoverClass {
    const kind = classifyElevenLabsHttpError(status, body);
    if (kind === 'fatal') {
      this.markReady(id);
      return 'fatal';
    }

    // Giọng Library / voice chưa có trên account này — thử key khác, KHÔNG exhausted
    // (cùng voiceId vẫn được giữ nguyên trên request).
    if (
      /library voices/i.test(body) ||
      /voice_not_found|invalid.?voice|unknown voice|does not exist/i.test(body)
    ) {
      this.markReady(id);
      return 'failover';
    }

    if (status === 401) {
      this.markInvalid(id);
      return 'failover';
    }
    // Free Tier bị ElevenLabs khóa (VPN / multi-account) — đánh invalid, thử key khác.
    if (isElevenLabsFreeTierDisabled(body)) {
      this.markInvalid(id);
      return 'failover';
    }
    if (status === 429 || /rate.?limit|too many requests/i.test(body)) {
      this.markRateLimited(id);
      return 'failover';
    }
    if (
      status === 402 ||
      status === 403 ||
      /quota|credit|exhausted|character limit|monthly|payment|upgrade/i.test(body)
    ) {
      this.markExhausted(id);
      return 'failover';
    }
    // Other 5xx → failover to next key
    if (status >= 500) {
      this.markRateLimited(id, 15_000);
      return 'failover';
    }
    this.markReady(id);
    return 'fatal';
  }

  static update(
    id: string,
    patch: Parameters<typeof updateElevenLabsKey>[1]
  ): ProviderApiKeyPublic[] {
    updateElevenLabsKey(id, patch);
    return listElevenLabsKeysPublic();
  }

  static remove(id: string): ProviderApiKeyPublic[] {
    deleteElevenLabsKey(id);
    return listElevenLabsKeysPublic();
  }

  static move(id: string, direction: 'up' | 'down'): ProviderApiKeyPublic[] {
    moveElevenLabsKey(id, direction);
    return listElevenLabsKeysPublic();
  }

  static resetStatus(id: string): ProviderApiKeyPublic[] {
    resetElevenLabsKeyStatus(id);
    return listElevenLabsKeysPublic();
  }

  static async testKey(id: string): Promise<{ ok: boolean; message: string }> {
    const records = loadElevenLabsKeyRecords();
    const target = records.find((r) => r.id === id);
    if (!target) return { ok: false, message: 'Không tìm thấy API key.' };
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: {
          Accept: 'application/json',
          'xi-api-key': target.apiKey,
        },
      });
      const text = await res.text();
      if (!res.ok) {
        this.applyHttpFailure(id, res.status, text);
        return {
          ok: false,
          message: `HTTP ${res.status}: ${text.slice(0, 180)}`,
        };
      }
      this.markSuccess(id);
      let email = '';
      try {
        email = String((JSON.parse(text) as { email?: string }).email || '');
      } catch {
        /* ignore */
      }
      return {
        ok: true,
        message: email ? `OK · ${email}` : 'API key hợp lệ.',
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Phân loại lỗi HTTP.
 * Hết token / rate limit / voice chưa có trên account → failover sang key khác
 * (giữ nguyên voiceId trong URL TTS). Chỉ fatal khi lỗi nội dung request thật sự.
 */
export function classifyElevenLabsHttpError(status: number, body: string): FailoverClass {
  const text = body || '';

  // Voice không có trên key/account này → thử key khác, không đổi giọng.
  if (
    /voice_not_found|invalid.?voice|unknown voice|does not exist|library voices/i.test(text)
  ) {
    return 'failover';
  }

  // Validation nội dung (text rỗng, param sai…) — không đổi key
  if (/validation|missing.?param|bad.?request/i.test(text) && status !== 401 && status !== 402) {
    if (!/quota|credit|limit|exhausted|rate.?limit/i.test(text)) return 'fatal';
  }

  if (status === 400 || status === 404 || status === 422) {
    if (/quota|credit|limit|exhausted|rate.?limit|voice/i.test(text)) return 'failover';
    return 'fatal';
  }
  if (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 429 ||
    status >= 500
  ) {
    return 'failover';
  }
  if (/quota|credit|exhausted|character limit|monthly|rate.?limit|too many requests/i.test(text)) {
    return 'failover';
  }
  return 'fatal';
}

export const ALL_KEYS_UNAVAILABLE_MESSAGE =
  'All ElevenLabs API Keys are unavailable. Please add a new API Key.';

/** ElevenLabs khóa Free Tier (VPN / nhiều account free…). */
export function isElevenLabsFreeTierDisabled(detail: string): boolean {
  return /unusual activity|free tier access has been disabled|using a proxy or vpn|multiple free accounts/i.test(
    detail || ''
  );
}

export function formatElevenLabsKeysUnavailableError(detail: string, voiceHint?: string): string {
  const voicePart = voiceHint ? ` ${voiceHint}` : '';
  if (isElevenLabsFreeTierDisabled(detail)) {
    return (
      `ElevenLabs đã khóa Free Tier trên (các) API key hiện tại vì phát hiện bất thường ` +
      `(VPN/proxy hoặc nhiều tài khoản free).${voicePart} ` +
      `Cách xử lý: (1) tắt VPN/proxy rồi thử lại, (2) thêm API key gói trả phí (Starter+), ` +
      `(3) hoặc chuyển dự án sang OpenAI TTS. ` +
      `Thêm key free mới cùng kiểu thường vẫn bị chặn.`
    );
  }
  return (
    `${ALL_KEYS_UNAVAILABLE_MESSAGE}${voicePart}` +
    (detail ? ` Chi tiết: ${detail.slice(0, 220)}` : '')
  );
}
