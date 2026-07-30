import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { ApiKeys, AppSettings } from '../shared/types';

const DEFAULT_KEYS: ApiKeys = {
  snapgenApiKey: '',
  openaiApiKey: '',
};

const DEFAULT_SETTINGS: AppSettings = {
  openaiModel: 'gpt-4o-mini',
  openaiTtsModel: 'gpt-4o-mini-tts',
  openaiTtsVoice: 'nova',
  burnSubtitles: false,
};

function storePath(): string {
  return path.join(app.getPath('userData'), 'studio-store.json');
}

interface StoreFile {
  keysEnc?: string;
  keysPlain?: ApiKeys & { elevenLabsApiKey?: string };
  settings: AppSettings & { elevenLabsVoiceId?: string };
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
      const parsed = JSON.parse(raw) as ApiKeys & { elevenLabsApiKey?: string };
      return {
        snapgenApiKey: parsed.snapgenApiKey ?? '',
        openaiApiKey: parsed.openaiApiKey ?? '',
      };
    } catch {
      return { ...DEFAULT_KEYS };
    }
  }
  const plain = (data.keysPlain ?? {}) as Partial<ApiKeys>;
  return {
    snapgenApiKey: plain.snapgenApiKey ?? '',
    openaiApiKey: plain.openaiApiKey ?? '',
  };
}

export function saveKeys(keys: ApiKeys): void {
  const data = readFile();
  const clean: ApiKeys = {
    snapgenApiKey: keys.snapgenApiKey,
    openaiApiKey: keys.openaiApiKey,
  };
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(JSON.stringify(clean)).toString('base64');
    data.keysEnc = enc;
    delete data.keysPlain;
  } else {
    data.keysPlain = clean;
    delete data.keysEnc;
  }
  writeFile(data);
}

export function getSettings(): AppSettings {
  const data = readFile();
  const merged = { ...DEFAULT_SETTINGS, ...data.settings };
  return {
    openaiModel: merged.openaiModel || DEFAULT_SETTINGS.openaiModel,
    openaiTtsModel: merged.openaiTtsModel || DEFAULT_SETTINGS.openaiTtsModel,
    openaiTtsVoice: merged.openaiTtsVoice || DEFAULT_SETTINGS.openaiTtsVoice,
    burnSubtitles: Boolean(merged.burnSubtitles),
    lastExportDir: merged.lastExportDir || '',
  };
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
