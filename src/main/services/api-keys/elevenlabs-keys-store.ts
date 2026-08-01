import { randomUUID } from 'node:crypto';
import { safeStorage } from 'electron';
import type {
  ProviderApiKeyPublic,
  ProviderApiKeyRecord,
  ProviderApiKeyStatus,
} from '../../../shared/provider-api-keys';
import { maskApiKey, toPublicApiKey } from '../../../shared/provider-api-keys';
import {
  getCapturedElevenLabsApiKey,
  readStoreFile,
  writeStoreFile,
  type StoredElevenLabsKeyBlob,
} from '../../store';

const RATE_LIMIT_COOLDOWN_MS = 60_000;

function encryptSecret(value: string): { enc?: string; plain?: string } {
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: safeStorage.encryptString(value).toString('base64') };
  }
  return { plain: value };
}

function decryptSecret(enc?: string, plain?: string): string {
  if (enc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return '';
    }
  }
  return plain ?? '';
}

function normalizeStatus(raw: unknown, enabled: boolean): ProviderApiKeyStatus {
  if (!enabled) return 'disabled';
  const value = String(raw || 'ready');
  const allowed: ProviderApiKeyStatus[] = [
    'ready',
    'active',
    'busy',
    'exhausted',
    'rate_limited',
    'invalid',
    'disabled',
  ];
  return (allowed.includes(value as ProviderApiKeyStatus)
    ? value
    : 'ready') as ProviderApiKeyStatus;
}

function blobToRecord(blob: StoredElevenLabsKeyBlob): ProviderApiKeyRecord | null {
  const apiKey = decryptSecret(blob.apiKeyEnc, blob.apiKeyPlain).trim();
  if (!/^(sk_|xi_)/i.test(apiKey)) return null;
  const enabled = blob.enabled !== false;
  return {
    id: blob.id || randomUUID(),
    name: blob.name,
    apiKey,
    priority: Number(blob.priority) || 1,
    enabled,
    status: normalizeStatus(blob.status, enabled),
    lastUsed: blob.lastUsed,
    cooldownUntil: blob.cooldownUntil,
  };
}

function recordToBlob(record: ProviderApiKeyRecord): StoredElevenLabsKeyBlob {
  const secret = encryptSecret(record.apiKey);
  return {
    id: record.id,
    name: record.name,
    apiKeyEnc: secret.enc,
    apiKeyPlain: secret.plain,
    priority: record.priority,
    enabled: record.enabled,
    status: record.status,
    lastUsed: record.lastUsed,
    cooldownUntil: record.cooldownUntil,
  };
}

function sortByPriority(records: ProviderApiKeyRecord[]): ProviderApiKeyRecord[] {
  return [...records].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function reindexPriorities(records: ProviderApiKeyRecord[]): ProviderApiKeyRecord[] {
  return sortByPriority(records).map((r, index) => ({ ...r, priority: index + 1 }));
}

/**
 * Đọc danh sách key; tự migrate legacy single key nếu chưa có list.
 */
export function loadElevenLabsKeyRecords(): ProviderApiKeyRecord[] {
  const data = readStoreFile();
  const blobs = data.elevenLabsKeys ?? [];
  let records = blobs
    .map(blobToRecord)
    .filter((r): r is ProviderApiKeyRecord => Boolean(r));

  if (!records.length) {
    const legacy = getCapturedElevenLabsApiKey().trim();
    if (/^(sk_|xi_)/i.test(legacy)) {
      records = [
        {
          id: randomUUID(),
          name: 'Primary',
          apiKey: legacy,
          priority: 1,
          enabled: true,
          status: 'ready',
        },
      ];
      saveElevenLabsKeyRecords(records);
    }
  }

  return reindexPriorities(records);
}

export function saveElevenLabsKeyRecords(records: ProviderApiKeyRecord[]): void {
  const data = readStoreFile();
  const normalized = reindexPriorities(records);
  data.elevenLabsKeys = normalized.map(recordToBlob);
  // Đồng bộ legacy field = key priority 1 (để probe/session cũ vẫn chạy).
  const primary = normalized.find((r) => r.enabled && r.status !== 'invalid') || normalized[0];
  if (primary?.apiKey) {
    if (safeStorage.isEncryptionAvailable()) {
      data.elevenLabsApiKeyEnc = safeStorage.encryptString(primary.apiKey).toString('base64');
      delete data.elevenLabsApiKeyPlain;
    } else {
      data.elevenLabsApiKeyPlain = primary.apiKey;
      delete data.elevenLabsApiKeyEnc;
    }
  }
  writeStoreFile(data);
}

export function listElevenLabsKeysPublic(): ProviderApiKeyPublic[] {
  const records = loadElevenLabsKeyRecords();
  const primary = pickNextAvailableRecord(records)?.id;
  return records.map((r) => toPublicApiKey(r, primary));
}

export function upsertElevenLabsKey(apiKey: string, name?: string): ProviderApiKeyRecord {
  const key = apiKey.trim();
  if (!/^(sk_|xi_)/i.test(key)) {
    throw new Error('API key ElevenLabs không hợp lệ (cần sk_… hoặc xi_…).');
  }
  const records = loadElevenLabsKeyRecords();
  const existing = records.find((r) => r.apiKey === key);
  if (existing) {
    existing.enabled = true;
    if (existing.status === 'invalid' || existing.status === 'exhausted') {
      existing.status = 'ready';
    }
    if (name?.trim()) existing.name = name.trim();
    existing.cooldownUntil = undefined;
    saveElevenLabsKeyRecords(records);
    return existing;
  }
  const next: ProviderApiKeyRecord = {
    id: randomUUID(),
    name: name?.trim() || `Key ${records.length + 1}`,
    apiKey: key,
    priority: records.length + 1,
    enabled: true,
    status: 'ready',
  };
  records.push(next);
  saveElevenLabsKeyRecords(records);
  return next;
}

export function updateElevenLabsKey(
  id: string,
  patch: {
    name?: string;
    apiKey?: string;
    enabled?: boolean;
    status?: ProviderApiKeyStatus;
    cooldownUntil?: number | null;
  }
): ProviderApiKeyRecord {
  const records = loadElevenLabsKeyRecords();
  const target = records.find((r) => r.id === id);
  if (!target) throw new Error('Không tìm thấy API key.');
  if (patch.name !== undefined) target.name = patch.name.trim() || target.name;
  if (patch.apiKey !== undefined) {
    const key = patch.apiKey.trim();
    if (!/^(sk_|xi_)/i.test(key)) {
      throw new Error('API key ElevenLabs không hợp lệ (cần sk_… hoặc xi_…).');
    }
    target.apiKey = key;
    target.status = 'ready';
    target.cooldownUntil = undefined;
  }
  if (patch.enabled !== undefined) {
    target.enabled = patch.enabled;
    target.status = patch.enabled
      ? target.status === 'disabled'
        ? 'ready'
        : target.status
      : 'disabled';
  }
  if (patch.status !== undefined) target.status = patch.status;
  if (patch.cooldownUntil === null) target.cooldownUntil = undefined;
  else if (patch.cooldownUntil !== undefined) target.cooldownUntil = patch.cooldownUntil;
  saveElevenLabsKeyRecords(records);
  return target;
}

export function deleteElevenLabsKey(id: string): void {
  const records = loadElevenLabsKeyRecords().filter((r) => r.id !== id);
  saveElevenLabsKeyRecords(records);
}

export function moveElevenLabsKey(id: string, direction: 'up' | 'down'): void {
  const records = sortByPriority(loadElevenLabsKeyRecords());
  const index = records.findIndex((r) => r.id === id);
  if (index < 0) throw new Error('Không tìm thấy API key.');
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= records.length) return;
  const tmp = records[index];
  records[index] = records[swapWith];
  records[swapWith] = tmp;
  saveElevenLabsKeyRecords(records);
}

export function resetElevenLabsKeyStatus(id: string): ProviderApiKeyRecord {
  return updateElevenLabsKey(id, {
    status: 'ready',
    cooldownUntil: null,
    enabled: true,
  });
}

function reviveCooldowns(records: ProviderApiKeyRecord[]): boolean {
  const now = Date.now();
  let changed = false;
  for (const record of records) {
    if (
      record.status === 'rate_limited' &&
      record.cooldownUntil &&
      record.cooldownUntil <= now &&
      record.enabled
    ) {
      record.status = 'ready';
      record.cooldownUntil = undefined;
      changed = true;
    }
    if (record.status === 'busy' && record.enabled) {
      // Stuck busy từ crash trước → sẵn sàng lại.
      record.status = 'ready';
      changed = true;
    }
    if (record.status === 'active' && record.enabled) {
      record.status = 'ready';
      changed = true;
    }
  }
  return changed;
}

export function pickNextAvailableRecord(
  records?: ProviderApiKeyRecord[],
  excludeIds?: Set<string>
): ProviderApiKeyRecord | null {
  let list = records ? [...records] : loadElevenLabsKeyRecords();
  if (reviveCooldowns(list)) {
    saveElevenLabsKeyRecords(list);
    list = loadElevenLabsKeyRecords();
  }
  const now = Date.now();
  for (const record of sortByPriority(list)) {
    if (excludeIds?.has(record.id)) continue;
    if (!record.enabled || record.status === 'disabled') continue;
    if (record.status === 'exhausted' || record.status === 'invalid') continue;
    if (
      record.status === 'rate_limited' &&
      record.cooldownUntil &&
      record.cooldownUntil > now
    ) {
      continue;
    }
    return record;
  }
  return null;
}

export function markElevenLabsKeyStatus(
  id: string,
  status: ProviderApiKeyStatus,
  options?: { cooldownMs?: number; touch?: boolean }
): void {
  const records = loadElevenLabsKeyRecords();
  const target = records.find((r) => r.id === id);
  if (!target) return;
  target.status = status;
  if (options?.touch) target.lastUsed = Date.now();
  if (status === 'rate_limited') {
    target.cooldownUntil = Date.now() + (options?.cooldownMs ?? RATE_LIMIT_COOLDOWN_MS);
  } else if (status === 'ready' || status === 'active' || status === 'busy') {
    target.cooldownUntil = undefined;
  }
  saveElevenLabsKeyRecords(records);
}

export function hasAnyElevenLabsApiKey(): boolean {
  return loadElevenLabsKeyRecords().some((r) => /^(sk_|xi_)/i.test(r.apiKey));
}

export { maskApiKey, RATE_LIMIT_COOLDOWN_MS };
