/**
 * Generic provider API key types — tái dùng cho OpenAI / Snapgen / Gemini sau này.
 */

export type ProviderApiKeyStatus =
  | 'ready'
  | 'active'
  | 'busy'
  | 'exhausted'
  | 'rate_limited'
  | 'invalid'
  | 'disabled';

export type ApiKeyProviderId = 'elevenlabs' | 'openai' | 'snapgen' | 'gemini';

export interface ProviderApiKeyRecord {
  id: string;
  name?: string;
  /** Plaintext chỉ tồn tại in-memory / khi decrypt từ store. */
  apiKey: string;
  priority: number;
  enabled: boolean;
  status: ProviderApiKeyStatus;
  lastUsed?: number;
  cooldownUntil?: number;
}

/** Bản gửi renderer — đã mask, không lộ full key. */
export interface ProviderApiKeyPublic {
  id: string;
  name?: string;
  maskedKey: string;
  priority: number;
  enabled: boolean;
  status: ProviderApiKeyStatus;
  lastUsed?: number;
  cooldownUntil?: number;
  isPrimary: boolean;
}

export function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (key.length <= 12) return `${key.slice(0, 4)}***`;
  return `${key.slice(0, 10)}${'*'.repeat(Math.min(20, key.length - 14))}${key.slice(-4)}`;
}

export function toPublicApiKey(
  record: ProviderApiKeyRecord,
  primaryId?: string | null
): ProviderApiKeyPublic {
  return {
    id: record.id,
    name: record.name,
    maskedKey: maskApiKey(record.apiKey),
    priority: record.priority,
    enabled: record.enabled,
    status: record.status,
    lastUsed: record.lastUsed,
    cooldownUntil: record.cooldownUntil,
    isPrimary: Boolean(primaryId && record.id === primaryId),
  };
}
