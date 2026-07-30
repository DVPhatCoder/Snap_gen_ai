import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { ApiKeys, AppSettings } from '../shared/types';

const DEFAULT_KEYS: ApiKeys = {
  snapgenApiKey: '',
  openaiApiKey: '',
  elevenLabsApiKey: '',
};

const DEFAULT_SETTINGS: AppSettings = {
  openaiModel: 'gpt-4o-mini',
  elevenLabsVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
  burnSubtitles: false,
};

function storePath(): string {
  return path.join(app.getPath('userData'), 'studio-store.json');
}

interface StoreFile {
  keysEnc?: string;
  keysPlain?: ApiKeys;
  settings: AppSettings;
}

function readFile(): StoreFile {
  const p = storePath();
  if (!fs.existsSync(p)) {
    return { settings: { ...DEFAULT_SETTINGS } };
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as StoreFile;
  } catch {
    return { settings: { ...DEFAULT_SETTINGS } };
  }
}

function writeFile(data: StoreFile): void {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(data, null, 2), 'utf8');
}

export function getKeys(): ApiKeys {
  const data = readFile();
  if (data.keysEnc && safeStorage.isEncryptionAvailable()) {
    try {
      const raw = safeStorage.decryptString(Buffer.from(data.keysEnc, 'base64'));
      return { ...DEFAULT_KEYS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_KEYS };
    }
  }
  return { ...DEFAULT_KEYS, ...(data.keysPlain ?? {}) };
}

export function saveKeys(keys: ApiKeys): void {
  const data = readFile();
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(JSON.stringify(keys)).toString('base64');
    data.keysEnc = enc;
    delete data.keysPlain;
  } else {
    data.keysPlain = keys;
    delete data.keysEnc;
  }
  writeFile(data);
}

export function getSettings(): AppSettings {
  const data = readFile();
  return { ...DEFAULT_SETTINGS, ...data.settings };
}

export function saveSettings(settings: AppSettings): void {
  const data = readFile();
  data.settings = { ...DEFAULT_SETTINGS, ...settings };
  writeFile(data);
}

export function getProjectsRoot(): string {
  const root = path.join(app.getPath('userData'), 'projects');
  fs.mkdirSync(root, { recursive: true });
  return root;
}
