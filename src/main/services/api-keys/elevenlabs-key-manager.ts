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

    // Free Tier bị ElevenLabs khóa (VPN / multi-account) — đánh invalid, thử key khác.
    if (isElevenLabsFreeTierDisabled(body)) {
      this.markInvalid(id);
      return 'failover';
    }

    // Hết quota/credit — kể cả khi HTTP 401 (ElevenLabs đôi khi trả vậy).
    if (
      status === 402 ||
      /quota_exceeded|exceeds your quota|credits remaining|insufficient.{0,20}credit|character limit|payment.?required/i.test(
        body
      ) ||
      ((status === 400 || status === 401 || status === 403) &&
        /quota|credit|exhausted|monthly|upgrade/i.test(body))
    ) {
      this.markExhausted(id);
      return 'failover';
    }

    if (status === 401) {
      // Thiếu scope (user_read…) ≠ key sai — không đánh invalid vội.
      if (/missing.?permission|missing_per|unauthorized/i.test(body) &&
          !/invalid.?api.?key|api key.*invalid/i.test(body)) {
        this.markReady(id);
        return 'failover';
      }
      this.markInvalid(id);
      return 'failover';
    }
    if (status === 429 || /rate.?limit|too many requests/i.test(body)) {
      this.markRateLimited(id);
      return 'failover';
    }
    if (status === 403 || /payment|upgrade/i.test(body)) {
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

    const headers = {
      Accept: 'application/json',
      'xi-api-key': target.apiKey,
    };

    try {
      // 1) /v1/user — optional (cần user_read). Thiếu quyền không = key hỏng.
      let email = '';
      const userRes = await fetch('https://api.elevenlabs.io/v1/user', { headers });
      const userText = await userRes.text();
      if (userRes.ok) {
        try {
          email = String((JSON.parse(userText) as { email?: string }).email || '');
        } catch {
          /* ignore */
        }
      } else if (isElevenLabsFreeTierDisabled(userText)) {
        this.applyHttpFailure(id, userRes.status, userText);
        return {
          ok: false,
          message:
            'ElevenLabs đã khóa Free Tier trên account này (VPN / nhiều account free). ' +
            'Reset Status không mở khóa được. Dùng account/key khác hoặc OpenAI TTS.',
        };
      } else if (
        userRes.status === 401 &&
        !/missing.?permission|user_read|missing_per/i.test(userText)
      ) {
        // Key sai thật sự
        this.markInvalid(id);
        return {
          ok: false,
          message: `API key không hợp lệ (HTTP 401). Tạo key mới tại ElevenLabs → API Keys.`,
        };
      }
      // missing user_read → bỏ qua, tiếp tục test voices/TTS

      // 2) /v1/voices — cần voices_read
      const voicesRes = await fetch('https://api.elevenlabs.io/v1/voices', { headers });
      const voicesText = await voicesRes.text();
      if (!voicesRes.ok) {
        if (isElevenLabsFreeTierDisabled(voicesText)) {
          this.applyHttpFailure(id, voicesRes.status, voicesText);
          return {
            ok: false,
            message:
              'Free Tier TTS/voices đã bị ElevenLabs khóa trên account này. Đổi key/account hoặc OpenAI TTS.',
          };
        }
        if (/missing.?permission|voices_read|missing_per/i.test(voicesText)) {
          return {
            ok: false,
            message:
              'API key thiếu quyền Voices Read. Vào elevenlabs.io → API Keys → Create Key, ' +
              'bật đủ quyền (hoặc unrestricted): Voices, Text to Speech, User — rồi dán key mới vào app.',
          };
        }
        this.applyHttpFailure(id, voicesRes.status, voicesText);
        return {
          ok: false,
          message: `HTTP ${voicesRes.status}: ${voicesText.slice(0, 180)}`,
        };
      }

      // 3) TTS premade ngắn — cần text_to_speech
      const probe = await fetch(
        'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM',
        {
          method: 'POST',
          headers: {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': target.apiKey,
          },
          body: JSON.stringify({
            text: 'Hi.',
            model_id: 'eleven_flash_v2_5',
          }),
        }
      );
      if (!probe.ok) {
        const probeText = await probe.text();
        if (isElevenLabsFreeTierDisabled(probeText)) {
          this.applyHttpFailure(id, probe.status, probeText);
          return {
            ok: false,
            message:
              'Key đọc voices được nhưng Free Tier TTS bị khóa. Đổi OpenAI TTS hoặc API key/account khác.',
          };
        }
        if (/missing.?permission|text_to_speech|missing_per/i.test(probeText)) {
          return {
            ok: false,
            message:
              'API key thiếu quyền Text to Speech. Tạo key mới với quyền Text to Speech (hoặc unrestricted).',
          };
        }
        this.applyHttpFailure(id, probe.status, probeText);
        return {
          ok: false,
          message: `Voices OK nhưng TTS fail HTTP ${probe.status}: ${probeText.slice(0, 160)}`,
        };
      }

      this.markSuccess(id);
      return {
        ok: true,
        message: email
          ? `OK · ${email} · TTS premade được`
          : 'API key OK · Voices + TTS premade được (thiếu user_read cũng không sao).',
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

/** Free không TTS được Voice Library qua API. */
export function isElevenLabsLibraryFreeBlocked(detail: string): boolean {
  return /free users cannot use library voices|library voices via the api|upgrade your subscription to use this voice/i.test(
    detail || ''
  );
}

export function formatElevenLabsKeysUnavailableError(detail: string, voiceHint?: string): string {
  const voicePart = voiceHint ? ` ${voiceHint}` : '';
  const statuses = summarizeElevenLabsKeyStatuses();

  if (isElevenLabsLibraryFreeBlocked(detail)) {
    return (
      `Giọng «Library» (kể cả miễn phí trên web) không TTS được bằng gói Free API.${voicePart} ` +
      `ElevenLabs cho nghe/dùng trên trang web, nhưng API Free vẫn từ chối mọi voice category=library ` +
      `(lỗi: Free users cannot use library voices via the API) — không phải hết token, không phải giọng trả phí. ` +
      `Trong SnapGen chỉ còn: (1) chọn giọng premade (Rachel, Adam…), (2) OpenAI TTS, ` +
      `(3) key gói Starter+ nếu muốn đúng giọng Library qua API. ` +
      `Đổi key Free khác cũng không được. Trạng thái key: ${statuses}.`
    );
  }

  if (isElevenLabsFreeTierDisabled(detail)) {
    return (
      `ElevenLabs đã khóa Free Tier trên (các) API key hiện tại vì phát hiện bất thường ` +
      `(VPN/proxy hoặc nhiều tài khoản free).${voicePart} ` +
      `Cách xử lý: (1) tắt VPN/proxy rồi thử lại, (2) thêm API key gói trả phí (Starter+), ` +
      `(3) hoặc chuyển dự án sang OpenAI TTS. ` +
      `Thêm key free mới cùng kiểu thường vẫn bị chặn. Trạng thái: ${statuses}.`
    );
  }

  const isQuota =
    /quota_exceeded|exceeds your quota|credits remaining|insufficient.{0,20}credit/i.test(
      detail || ''
    );

  if (isQuota) {
    return (
      `ElevenLabs hết credit/quota trên các key còn dùng được.${voicePart} ` +
      `App đã thử chuyển key theo Priority — nếu mọi key cùng một account thì chúng CHUNG credit, đổi key không giúp. ` +
      `Cần: key từ account ElevenLabs khác còn credit, hoặc nạp/nâng gói, hoặc OpenAI TTS / Giữ voiceover. ` +
      `Trạng thái key: ${statuses}. ` +
      (detail ? `Chi tiết: ${detail.slice(0, 180)}` : '')
    );
  }

  return (
    `${ALL_KEYS_UNAVAILABLE_MESSAGE}${voicePart} ` +
    `Trạng thái key: ${statuses}.` +
    (detail ? ` Chi tiết: ${detail.slice(0, 220)}` : '')
  );
}

export function summarizeElevenLabsKeyStatuses(): string {
  const list = listElevenLabsKeysPublic();
  if (!list.length) return 'chưa có key';
  return list
    .map((k) => `${k.name || 'Key'}(P${k.priority}:${k.status}${k.enabled ? '' : ',off'})`)
    .join(', ');
}
