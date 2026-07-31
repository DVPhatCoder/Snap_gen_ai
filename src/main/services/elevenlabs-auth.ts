import { BrowserWindow, session, type Cookie } from 'electron';
import {
  clearCapturedElevenLabsApiKey,
  getCapturedElevenLabsApiKey,
  getCapturedElevenLabsAuthorization,
  getElevenLabsMeta,
  hasCapturedElevenLabsCredential,
  saveCapturedElevenLabsApiKey,
  saveCapturedElevenLabsAuthorization,
  saveElevenLabsMeta,
  type ElevenLabsMeta,
} from '../store';
import type { ElevenLabsSessionStatus } from '../../shared/types';

const PARTITION = 'persist:elevenlabs';
const LOGIN_URL = 'https://elevenlabs.io/app/sign-in';
const APP_HOME_URL = 'https://elevenlabs.io/app/speech-synthesis';
const API_KEYS_URLS = [
  'https://elevenlabs.io/app/settings/api-keys',
  'https://elevenlabs.io/app/developers/api-keys',
];
const APP_HOSTS = ['elevenlabs.io', 'www.elevenlabs.io', 'api.elevenlabs.io', 'api.us.elevenlabs.io'];

const AUTH_COOKIE_HINTS = [
  'st-access-token',
  'st-refresh-token',
  'sAccessToken',
  'sRefreshToken',
  'access_token',
  'refresh_token',
  'session',
  'auth',
];

let loginWindow: BrowserWindow | null = null;
let statusListeners: Array<(status: ElevenLabsSessionStatus) => void> = [];
let keyCaptureInstalled = false;

function elevenLabsSession() {
  return session.fromPartition(PARTITION);
}

function isLikelyJwt(value: string): boolean {
  const raw = value.replace(/^Bearer\s+/i, '').trim();
  return raw.startsWith('eyJ');
}

function isLikelyElevenLabsApiKey(value: string): boolean {
  const key = value.trim();
  if (!key || key.length < 20) return false;
  if (isLikelyJwt(key)) return false;
  if (/^(sk_|xi_)/i.test(key)) return true;
  // Dashboard free keys can be opaque tokens without a fixed prefix.
  return /^[A-Za-z0-9_\-]{20,}$/.test(key);
}

/** Official API needs credentials; capture them from the logged-in web app traffic. */
export function installElevenLabsApiKeyCapture(): void {
  if (keyCaptureInstalled) return;
  keyCaptureInstalled = true;
  elevenLabsSession().webRequest.onBeforeSendHeaders(
    { urls: ['https://api.elevenlabs.io/*', 'https://api.us.elevenlabs.io/*'] },
    (details, callback) => {
      const headers = details.requestHeaders;
      const rawKey = headers['xi-api-key'] || headers['Xi-Api-Key'] || headers['XI-API-KEY'];
      const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
      if (typeof key === 'string' && isLikelyElevenLabsApiKey(key)) {
        saveCapturedElevenLabsApiKey(key.trim());
      }
      const rawAuth = headers.Authorization || headers.authorization;
      const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
      if (typeof auth === 'string' && auth.trim().length > 8) {
        saveCapturedElevenLabsAuthorization(auth.trim());
      }
      callback({ requestHeaders: headers });
    }
  );
}

function isAuthCookie(cookie: Cookie): boolean {
  const name = cookie.name.toLowerCase();
  return AUTH_COOKIE_HINTS.some((hint) => name.includes(hint.toLowerCase()));
}

function looksLoggedInUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('elevenlabs.io')) return false;
    const path = u.pathname.toLowerCase();
    if (path.includes('sign-in') || path.includes('sign-up') || path.includes('login')) {
      return false;
    }
    return path.startsWith('/app');
  } catch {
    return false;
  }
}

async function listRelevantCookies(): Promise<Cookie[]> {
  const ses = elevenLabsSession();
  const all = await ses.cookies.get({});
  return all.filter((cookie) =>
    APP_HOSTS.some(
      (host) =>
        cookie.domain === host ||
        cookie.domain === `.${host}` ||
        (cookie.domain?.endsWith(host) ?? false)
    )
  );
}

export async function getElevenLabsCookieHeader(): Promise<string> {
  const cookies = await listRelevantCookies();
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function extractApiKeyFromPage(win: BrowserWindow): Promise<string | null> {
  try {
    const found = (await win.webContents.executeJavaScript(`
      (() => {
        const pick = (value) => {
          if (typeof value !== 'string') return null;
          const v = value.trim().replace(/^"|"$/g, '');
          if (v.length < 16) return null;
          if (/^eyJ/.test(v)) return null;
          if (/^(sk_|xi_)/i.test(v)) return v;
          return null;
        };
        const walk = (node, depth = 0) => {
          if (!node || depth > 6) return null;
          if (typeof node === 'string') return pick(node);
          if (typeof node !== 'object') return null;
          for (const [key, value] of Object.entries(node)) {
            if (/api[_-]?key|xi[_-]?api/i.test(key)) {
              const hit = pick(typeof value === 'string' ? value : JSON.stringify(value));
              if (hit) return hit;
            }
            const nested = walk(value, depth + 1);
            if (nested) return nested;
          }
          return null;
        };
        const scanStorage = (storage) => {
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            const raw = storage.getItem(key) || '';
            if (/api[_-]?key|xi[_-]?api/i.test(key || '')) {
              const hit = pick(raw);
              if (hit) return hit;
            }
            try {
              const hit = walk(JSON.parse(raw));
              if (hit) return hit;
            } catch {}
          }
          return null;
        };
        return scanStorage(localStorage) || scanStorage(sessionStorage);
      })()
    `)) as string | null;
    if (found) {
      saveCapturedElevenLabsApiKey(found);
      return found;
    }
  } catch {
    // ignore
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getValidApiKey(): string {
  const key = getCapturedElevenLabsApiKey().trim();
  return isLikelyElevenLabsApiKey(key) ? key : '';
}

function purgeInvalidStoredApiKey(): void {
  const key = getCapturedElevenLabsApiKey().trim();
  if (key && !isLikelyElevenLabsApiKey(key)) {
    clearCapturedElevenLabsApiKey();
  }
}

async function readApiKeyFromDom(win: BrowserWindow): Promise<string | null> {
  try {
    const found = (await win.webContents.executeJavaScript(`
      (() => {
        const pick = (v) => {
          if (typeof v !== 'string') return null;
          const t = v.trim();
          if (/^(sk_|xi_)/i.test(t) && t.length >= 20) return t;
          return null;
        };
        const nodes = Array.from(document.querySelectorAll('input, textarea, code, pre, span, p, div'));
        for (const node of nodes) {
          const hit = pick(node.value || node.textContent || '');
          if (hit) return hit;
        }
        return null;
      })()
    `)) as string | null;
    if (found) {
      saveCapturedElevenLabsApiKey(found);
      return found;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * After web login, open API Keys page and try to create/capture a FREE api key.
 * Official TTS API cannot use cookie/JWT alone.
 */
async function provisionApiKeyFromBrowser(win: BrowserWindow): Promise<string> {
  purgeInvalidStoredApiKey();
  const existing = getValidApiKey();
  if (existing) return existing;

  for (const url of API_KEYS_URLS) {
    try {
      await win.loadURL(url);
      await sleep(2500);
      await extractApiKeyFromPage(win);
      let key = getValidApiKey() || (await readApiKeyFromDom(win)) || '';
      if (key) return key;

      await win.webContents.executeJavaScript(`
        (() => {
          const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
          const match = (text) => /create.*(?:api\\s*)?key|new\\s*(?:api\\s*)?key|generate.*key/i.test(text || '');
          const btn = buttons.find((b) => match(b.textContent));
          if (btn) { btn.click(); return true; }
          return false;
        })()
      `);
      await sleep(1500);

      await win.webContents.executeJavaScript(`
        (() => {
          const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
          const match = (text) => /^(create|confirm|save|generate)$/i.test((text || '').trim()) || /create key|create api/i.test(text || '');
          const btn = [...buttons].reverse().find((b) => match(b.textContent));
          if (btn) { btn.click(); return true; }
          return false;
        })()
      `);

      await waitForCapturedApiKey(12000);
      key = getValidApiKey() || (await readApiKeyFromDom(win)) || '';
      if (key) return key;
    } catch {
      // try next url
    }
  }

  return getValidApiKey();
}

async function waitForCapturedApiKey(timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (getValidApiKey()) return true;
    await sleep(250);
  }
  return Boolean(getValidApiKey());
}

async function bearerFromCookies(): Promise<string> {
  const cookies = await listRelevantCookies();
  const access = cookies.find((cookie) =>
    /access.?token|st-access-token|sAccessToken/i.test(cookie.name)
  );
  if (!access?.value) return '';
  const value = access.value.trim();
  return value ? (`Bearer ${value.replace(/^Bearer\s+/i, '')}` as const) : '';
}

async function probeUser(apiKey: string, cookieHeader: string): Promise<{
  ok: boolean;
  email?: string;
  displayName?: string;
}> {
  const endpoints = [
    'https://api.elevenlabs.io/v1/user',
    'https://api.us.elevenlabs.io/v1/user',
  ];

  for (const url of endpoints) {
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      };
      if (apiKey) headers['xi-api-key'] = apiKey;
      if (cookieHeader) headers.Cookie = cookieHeader;

      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        email?: string;
        first_name?: string;
        last_name?: string;
      };
      const displayName = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();
      return {
        ok: true,
        email: data.email,
        displayName: displayName || undefined,
      };
    } catch {
      // try next
    }
  }
  return { ok: false };
}

async function readPageAuthHints(win: BrowserWindow): Promise<{
  email?: string;
  displayName?: string;
  hasLocalAuth: boolean;
}> {
  try {
    const result = (await win.webContents.executeJavaScript(`
      (() => {
        const keys = Object.keys(localStorage || {});
        let hasLocalAuth = false;
        for (const key of keys) {
          if (/token|auth|session|user|st-|api/i.test(key)) {
            const value = localStorage.getItem(key) || '';
            if (value.length > 8) hasLocalAuth = true;
          }
        }
        let email;
        try {
          const scripts = Array.from(document.querySelectorAll('script'));
          for (const node of scripts) {
            const text = node.textContent || '';
            const m = text.match(/"email"\\s*:\\s*"([^"]+@[^"]+)"/);
            if (m) { email = m[1]; break; }
          }
        } catch {}
        const bodyText = document.body?.innerText || '';
        if (!email) {
          const m = bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i);
          if (m) email = m[0];
        }
        return { email, hasLocalAuth, href: location.href };
      })()
    `)) as {
      email?: string;
      hasLocalAuth: boolean;
    };
    return result;
  } catch {
    return { hasLocalAuth: false };
  }
}

function toStatus(meta: ElevenLabsMeta): ElevenLabsSessionStatus {
  return {
    loggedIn: Boolean(meta.loggedIn),
    email: meta.email,
    displayName: meta.displayName,
    updatedAt: meta.updatedAt,
    cookieCount: meta.cookieCount ?? 0,
    hasApiCredential: hasCapturedElevenLabsCredential(),
  };
}

function emitStatus(status: ElevenLabsSessionStatus): void {
  for (const listener of statusListeners) {
    try {
      listener(status);
    } catch {
      // ignore listener errors
    }
  }
}

let lastEmittedStatusKey = '';

function emitStatusIfChanged(status: ElevenLabsSessionStatus): void {
  const key = [
    status.loggedIn,
    status.hasApiCredential,
    status.email || '',
    status.cookieCount,
  ].join('|');
  if (key === lastEmittedStatusKey) return;
  lastEmittedStatusKey = key;
  emitStatus(status);
}

export function onElevenLabsSessionChange(
  listener: (status: ElevenLabsSessionStatus) => void
): () => void {
  statusListeners.push(listener);
  return () => {
    statusListeners = statusListeners.filter((item) => item !== listener);
  };
}

export async function syncElevenLabsSession(options?: {
  forceProbe?: boolean;
  pageHints?: { email?: string; displayName?: string; hasLocalAuth?: boolean };
}): Promise<ElevenLabsSessionStatus> {
  installElevenLabsApiKeyCapture();
  const cookies = await listRelevantCookies();
  const authCookies = cookies.filter(isAuthCookie);
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  const apiKey = getCapturedElevenLabsApiKey();
  const hasCred = hasCapturedElevenLabsCredential();
  const previous = getElevenLabsMeta();

  let email = options?.pageHints?.email || previous.email;
  let displayName = options?.pageHints?.displayName || previous.displayName;
  let loggedIn =
    authCookies.length > 0 ||
    Boolean(options?.pageHints?.hasLocalAuth) ||
    hasCred ||
    previous.loggedIn;

  if (options?.forceProbe || loggedIn) {
    const probed = await probeUser(apiKey, cookieHeader);
    if (probed.ok) {
      loggedIn = true;
      email = probed.email || email;
      displayName = probed.displayName || displayName;
    } else if (authCookies.length === 0 && !options?.pageHints?.hasLocalAuth && !hasCred) {
      loggedIn = false;
    }
  }

  if (!cookieHeader && authCookies.length === 0 && !options?.pageHints?.hasLocalAuth && !hasCred) {
    loggedIn = false;
    email = undefined;
    displayName = undefined;
  }

  const meta: ElevenLabsMeta = {
    loggedIn,
    email,
    displayName,
    updatedAt: new Date().toISOString(),
    cookieCount: cookies.length,
  };
  saveElevenLabsMeta(meta);

  const status = toStatus(meta);
  emitStatusIfChanged(status);
  return status;
}

export async function getElevenLabsSessionStatus(): Promise<ElevenLabsSessionStatus> {
  return syncElevenLabsSession({ forceProbe: true });
}

export async function clearElevenLabsSession(): Promise<ElevenLabsSessionStatus> {
  const ses = elevenLabsSession();
  const cookies = await listRelevantCookies();
  await Promise.all(
    cookies.map((cookie) => {
      const url = `http${cookie.secure ? 's' : ''}://${cookie.domain?.replace(/^\./, '')}${cookie.path || '/'}`;
      return ses.cookies.remove(url, cookie.name).catch(() => undefined);
    })
  );
  try {
    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
    });
  } catch {
    // best-effort
  }

  clearCapturedElevenLabsApiKey();
  saveElevenLabsMeta({
    loggedIn: false,
    updatedAt: new Date().toISOString(),
    cookieCount: 0,
  });

  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.close();
  }

  const status: ElevenLabsSessionStatus = {
    loggedIn: false,
    updatedAt: new Date().toISOString(),
    cookieCount: 0,
    hasApiCredential: false,
  };
  lastEmittedStatusKey = '';
  emitStatus(status);
  return status;
}

export async function saveElevenLabsApiKeyManually(apiKey: string): Promise<ElevenLabsSessionStatus> {
  const key = apiKey.trim();
  if (!isLikelyElevenLabsApiKey(key)) {
    throw new Error(
      'API key không hợp lệ. Lấy key free tại Developers → API Keys trên ElevenLabs (thường bắt đầu bằng sk_ hoặc là chuỗi dài).'
    );
  }
  // Verify before saving.
  const res = await fetch('https://api.elevenlabs.io/v1/user', {
    headers: { Accept: 'application/json', 'xi-api-key': key },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API key bị ElevenLabs từ chối (HTTP ${res.status}): ${body.slice(0, 160)}`);
  }
  saveCapturedElevenLabsApiKey(key);
  const data = (await res.json()) as { email?: string; first_name?: string };
  saveElevenLabsMeta({
    loggedIn: true,
    email: data.email,
    displayName: data.first_name,
    updatedAt: new Date().toISOString(),
    cookieCount: (await listRelevantCookies()).length,
  });
  return getElevenLabsSessionStatus();
}

export async function openElevenLabsApiKeysPage(
  parent?: BrowserWindow | null
): Promise<ElevenLabsSessionStatus> {
  installElevenLabsApiKeyCapture();
  purgeInvalidStoredApiKey();

  if (loginWindow && !loginWindow.isDestroyed()) {
    await loginWindow.loadURL(API_KEYS_URLS[0]);
    loginWindow.focus();
    return getElevenLabsSessionStatus();
  }

  loginWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    parent: parent ?? undefined,
    modal: false,
    title: 'ElevenLabs — Tạo API Key free rồi đóng cửa sổ',
    backgroundColor: '#0b0c0f',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const win = loginWindow;
  win.webContents.on('did-finish-load', () => {
    void extractApiKeyFromPage(win);
    void readApiKeyFromDom(win).then((key) => {
      if (!key) return;
      void syncElevenLabsSession({ forceProbe: true });
    });
  });
  win.on('closed', () => {
    loginWindow = null;
    void syncElevenLabsSession({ forceProbe: true });
  });

  await win.loadURL(API_KEYS_URLS[0]);
  return getElevenLabsSessionStatus();
}

export async function openElevenLabsLogin(
  parent?: BrowserWindow | null
): Promise<ElevenLabsSessionStatus> {
  installElevenLabsApiKeyCapture();

  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return getElevenLabsSessionStatus();
  }

  loginWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    parent: parent ?? undefined,
    modal: false,
    title: 'ElevenLabs — Đăng nhập',
    backgroundColor: '#0b0c0f',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const win = loginWindow;
  let settled = false;

  const finishLogin = async () => {
    if (settled || !win || win.isDestroyed()) return;
    settled = true;
    purgeInvalidStoredApiKey();
    let key = getValidApiKey();
    if (!key) {
      key = await provisionApiKeyFromBrowser(win);
    }
    await syncElevenLabsSession({ forceProbe: true });
    if (key) {
      setTimeout(() => {
        if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
      }, 800);
    } else {
      // Keep window on API keys page so user can click Create once; app will capture it.
      try {
        await win.loadURL(API_KEYS_URLS[0]);
        win.setTitle('ElevenLabs — Bấm Create API Key (free), app sẽ tự lấy');
      } catch {
        // ignore
      }
    }
  };

  const tryCapture = async (reason: string) => {
    if (!win || win.isDestroyed() || settled) return;
    const url = win.webContents.getURL();
    if (!looksLoggedInUrl(url) && reason !== 'manual-check') return;

    const pageHints = await readPageAuthHints(win);
    const cookies = await listRelevantCookies();
    const authCookies = cookies.filter(isAuthCookie);
    if (!authCookies.length && !pageHints.hasLocalAuth && !looksLoggedInUrl(url)) {
      return;
    }

    const status = await syncElevenLabsSession({
      forceProbe: true,
      pageHints,
    });

    if (status.loggedIn) {
      await finishLogin();
    }
  };

  win.webContents.on('did-navigate', () => {
    void tryCapture('navigate');
  });
  win.webContents.on('did-navigate-in-page', () => {
    void tryCapture('in-page');
  });
  win.webContents.on('did-finish-load', () => {
    void tryCapture('load');
    void extractApiKeyFromPage(win);
    void readApiKeyFromDom(win).then((key) => {
      if (!key) return;
      void syncElevenLabsSession({ forceProbe: true });
      setTimeout(() => {
        if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
      }, 500);
    });
  });

  const cookieListener = (
    _event: { preventDefault: () => void; readonly defaultPrevented: boolean },
    cookie: Cookie,
    _cause: string,
    removed: boolean
  ) => {
    const domain = cookie.domain || '';
    if (!APP_HOSTS.some((host) => domain.includes(host.replace(/^www\./, '')))) return;
    if (removed) return;
    if (!isAuthCookie(cookie) && !looksLoggedInUrl(win.webContents.getURL())) return;
    void tryCapture('cookie');
  };
  elevenLabsSession().cookies.on('changed', cookieListener);

  win.on('closed', () => {
    elevenLabsSession().cookies.removeListener('changed', cookieListener);
    loginWindow = null;
    void syncElevenLabsSession({ forceProbe: true });
  });

  await win.loadURL(LOGIN_URL);
  return getElevenLabsSessionStatus();
}

/**
 * Official ElevenLabs API requires a real xi-api-key (free tier OK).
 * Cookie/JWT login alone cannot call TTS — after login we provision a free key.
 */
export async function ensureElevenLabsApiCredential(
  parent?: BrowserWindow | null
): Promise<string> {
  installElevenLabsApiKeyCapture();
  purgeInvalidStoredApiKey();
  const existing = getValidApiKey();
  if (existing) return existing;

  await openElevenLabsLogin(parent);
  const ok = await waitForCapturedApiKey(45000);
  const key = getValidApiKey();
  if (!ok || !key) {
    throw new Error(
      'ElevenLabs TTS cần API key free. Vào Settings → Mở trang API Keys → Create Key, rồi dán key vào ô trong Settings và bấm Lưu API key.'
    );
  }
  return key;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Authenticated fetch against ElevenLabs API using a real xi-api-key
 * auto-provisioned from the logged-in free account.
 */
export async function elevenLabsFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  installElevenLabsApiKeyCapture();
  const apiKey = await ensureElevenLabsApiCredential();

  const headerRecord: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'xi-api-key': apiKey,
  };

  if (init.headers) {
    const extra =
      init.headers instanceof Headers
        ? headersToRecord(init.headers)
        : Array.isArray(init.headers)
          ? Object.fromEntries(init.headers)
          : { ...(init.headers as Record<string, string>) };
    Object.assign(headerRecord, extra);
    // Never mix Authorization with xi-api-key.
    delete headerRecord.Authorization;
    delete headerRecord.authorization;
    headerRecord['xi-api-key'] = apiKey;
  }

  return fetch(input, {
    method: init.method,
    body: init.body,
    headers: headerRecord,
  });
}

export async function testElevenLabsSession(): Promise<{ ok: boolean; message: string }> {
  purgeInvalidStoredApiKey();
  const status = await getElevenLabsSessionStatus();
  const key = getValidApiKey();
  if (!status.loggedIn && !key) {
    return {
      ok: false,
      message: 'Chưa đăng nhập ElevenLabs. Bấm Đăng nhập trong Settings.',
    };
  }
  if (!key) {
    return {
      ok: false,
      message:
        'Đã login web nhưng chưa có API key free. Mở Đăng nhập lại → trang API Keys → bấm Create Key một lần (app tự bắt).',
    };
  }

  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: {
        Accept: 'application/json',
        'xi-api-key': key,
      },
    });
    if (!res.ok) {
      clearCapturedElevenLabsApiKey();
      return {
        ok: false,
        message: `API key không hợp lệ (HTTP ${res.status}). Đăng nhập lại và Create Key mới.`,
      };
    }
    const data = (await res.json()) as { email?: string };
    return {
      ok: true,
      message: `ElevenLabs OK (${data.email || status.email || 'account'}) · API key free sẵn sàng cho TTS.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
