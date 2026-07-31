import { useEffect, useState } from 'react';
import type {
  ApiKeys,
  AppSettings,
  ElevenLabsSessionStatus,
  ElevenLabsVoice,
} from '../../shared/types';
import { ELEVENLABS_TTS_MODELS, OPENAI_TTS_MODELS, OPENAI_TTS_VOICES } from '../../shared/types';

export default function Settings() {
  const [keys, setKeys] = useState<ApiKeys>({
    snapgenApiKey: '',
    openaiApiKey: '',
  });
  const [settings, setSettings] = useState<AppSettings>({
    openaiModel: 'gpt-4o-mini',
    openaiTtsModel: 'gpt-4o-mini-tts',
    openaiTtsVoice: 'nova',
    ttsProvider: 'openai',
    elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
    elevenLabsModelId: 'eleven_flash_v2_5',
    burnSubtitles: false,
  });
  const [elevenLabs, setElevenLabs] = useState<ElevenLabsSessionStatus>({
    loggedIn: false,
    cookieCount: 0,
  });
  const [elevenLabsApiKeyInput, setElevenLabsApiKeyInput] = useState('');
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const elevenLabsReady = elevenLabs.loggedIn || !!elevenLabs.hasApiCredential;

  const loadVoices = async (force = false) => {
    if (!force && voicesLoaded) return;
    try {
      const list = await window.studio.listElevenLabsVoices();
      setVoices(list);
      setVoicesLoaded(true);
      setSettings((prev) => {
        if (list.length && !list.some((v) => v.voiceId === prev.elevenLabsVoiceId)) {
          return { ...prev, elevenLabsVoiceId: list[0].voiceId };
        }
        return prev;
      });
    } catch {
      setVoices([]);
      setVoicesLoaded(false);
    }
  };

  useEffect(() => {
    void (async () => {
      setKeys(await window.studio.getKeys());
      const nextSettings = await window.studio.getSettings();
      setSettings(nextSettings);
      const session = await window.studio.getElevenLabsSession();
      setElevenLabs(session);
      if (session.loggedIn && session.hasApiCredential) {
        await loadVoices(true);
      }
    })();
    return window.studio.onElevenLabsSessionChange((status) => {
      setElevenLabs((prev) => {
        const same =
          prev.loggedIn === status.loggedIn &&
          prev.hasApiCredential === status.hasApiCredential &&
          prev.email === status.email &&
          prev.cookieCount === status.cookieCount;
        return same ? prev : status;
      });
      if (!status.loggedIn) {
        setVoices([]);
        setVoicesLoaded(false);
      }
      // Do NOT auto-spam listVoices on every session sync event.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveAll = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await window.studio.saveKeys(keys);
      await window.studio.saveSettings(settings);
      setMsg({
        type: 'ok',
        text: 'Đã lưu API keys và settings trên máy (encrypted nếu hệ thống hỗ trợ).',
      });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const test = async (kind: 'snapgen' | 'openai' | 'elevenlabs') => {
    setBusy(true);
    setMsg(null);
    try {
      if (kind !== 'elevenlabs') await window.studio.saveKeys(keys);
      const res =
        kind === 'snapgen'
          ? await window.studio.testSnapgen()
          : kind === 'openai'
            ? await window.studio.testOpenAI()
            : await window.studio.testElevenLabs();
      if (kind === 'elevenlabs') {
        setElevenLabs(await window.studio.getElevenLabsSession());
        if (res.ok) await loadVoices(true);
      }
      setMsg({ type: res.ok ? 'ok' : 'error', text: res.message });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const loginElevenLabs = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const status = await window.studio.openElevenLabsLogin();
      setElevenLabs(status);
      if (status.loggedIn) {
        await loadVoices(true);
        setSettings((prev) => ({ ...prev, ttsProvider: 'elevenlabs' }));
      }
      setMsg({
        type: 'ok',
        text: status.loggedIn
          ? `Đã lưu session ElevenLabs${status.email ? ` (${status.email})` : ''}. Có thể chọn giọng bên dưới.`
          : 'Đã mở trình duyệt ElevenLabs. Đăng nhập xong app sẽ tự lưu cookies/session.',
      });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const logoutElevenLabs = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const status = await window.studio.clearElevenLabsSession();
      setElevenLabs(status);
      setVoices([]);
      setElevenLabsApiKeyInput('');
      if (settings.ttsProvider === 'elevenlabs') {
        setSettings((prev) => ({ ...prev, ttsProvider: 'openai' }));
      }
      setMsg({ type: 'ok', text: 'Đã xóa cookies/session ElevenLabs trên máy.' });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const openApiKeysPage = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const status = await window.studio.openElevenLabsApiKeys();
      setElevenLabs(status);
      setMsg({
        type: 'ok',
        text: 'Đã mở trang API Keys. Bấm Create Key (free), copy key, rồi dán vào ô bên dưới.',
      });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const saveApiKeyManual = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const status = await window.studio.saveElevenLabsApiKey(elevenLabsApiKeyInput);
      setElevenLabs(status);
      setElevenLabsApiKeyInput('');
      setSettings((prev) => ({ ...prev, ttsProvider: 'elevenlabs' }));
      await loadVoices(true);
      setMsg({
        type: 'ok',
        text: `Đã lưu API key ElevenLabs${status.email ? ` (${status.email})` : ''}. Có thể chọn giọng bên dưới.`,
      });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel settings-panel">
      <div className="panel-hero">
        <p className="eyebrow">Cấu hình</p>
        <h1>API &amp; Voice</h1>
        <p className="sub">
          Chọn nguồn giọng đọc: OpenAI TTS hoặc ElevenLabs (API key free — dán một lần là dùng được).
        </p>
      </div>

      <section className="settings-block">
        <h2>API Keys</h2>
        <div className="field">
          <label htmlFor="snapgen">Snapgen API Key</label>
          <input
            id="snapgen"
            type="password"
            value={keys.snapgenApiKey}
            onChange={(e) => setKeys({ ...keys, snapgenApiKey: e.target.value })}
            placeholder="sk_..."
          />
        </div>
        <div className="field">
          <label htmlFor="openai">OpenAI API Key</label>
          <input
            id="openai"
            type="password"
            value={keys.openaiApiKey}
            onChange={(e) => setKeys({ ...keys, openaiApiKey: e.target.value })}
            placeholder="sk-..."
          />
          <p className="hint">Vẫn cần OpenAI để viết kịch bản (ChatGPT), kể cả khi voice dùng ElevenLabs.</p>
        </div>
      </section>

      <section className="settings-block" id="elevenlabs">
        <h2>ElevenLabs</h2>
        <p className="settings-note">
          API TTS của ElevenLabs bắt buộc có API key (tier free cũng được). Cách nhanh nhất: mở trang
          API Keys → Create Key → copy → dán vào ô bên dưới → Lưu API key.
        </p>
        <div className={`session-card ${elevenLabsReady ? 'ok' : ''}`}>
          <div className="session-card-main">
            <span className={`session-dot ${elevenLabsReady ? 'on' : ''}`} />
            <div>
              <strong>
                {elevenLabs.hasApiCredential
                  ? 'Đã có API key TTS'
                  : elevenLabs.loggedIn
                    ? 'Đã đăng nhập (chưa có API key)'
                    : 'Chưa cấu hình'}
              </strong>
              <p>
                {elevenLabsReady
                  ? [
                      elevenLabs.email || elevenLabs.displayName || 'Credential đã lưu',
                      elevenLabs.cookieCount ? `${elevenLabs.cookieCount} cookies` : null,
                      elevenLabs.hasApiCredential ? 'credential TTS OK' : 'thiếu API key',
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'Chưa có API key ElevenLabs trên máy này.'}
              </p>
            </div>
          </div>
          <div className="session-card-actions">
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void openApiKeysPage()}
            >
              Mở trang API Keys
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void loginElevenLabs()}
            >
              Đăng nhập web
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void test('elevenlabs')}
            >
              Kiểm tra
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !elevenLabsReady}
              onClick={() => void loadVoices(true)}
            >
              Tải danh sách giọng
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !elevenLabsReady}
              onClick={() => void logoutElevenLabs()}
            >
              Xóa session / key
            </button>
          </div>
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="el-api-key">Dán API key free</label>
          <input
            id="el-api-key"
            type="password"
            value={elevenLabsApiKeyInput}
            onChange={(e) => setElevenLabsApiKeyInput(e.target.value)}
            placeholder="sk_... hoặc xi_... (từ Developers → API Keys)"
            autoComplete="off"
          />
          <p className="hint">
            Key chỉ lưu encrypted trên máy bạn. Free tier vẫn dùng được — không cần gói trả phí.
          </p>
        </div>
        <div className="row-actions" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !elevenLabsApiKeyInput.trim()}
            onClick={() => void saveApiKeyManual()}
          >
            Lưu API key
          </button>
        </div>
      </section>

      <section className="settings-block">
        <h2>Voiceover</h2>
        <div className="field">
          <label htmlFor="tts-provider">Nguồn giọng đọc</label>
          <select
            id="tts-provider"
            value={settings.ttsProvider}
            onChange={(e) =>
              setSettings({
                ...settings,
                ttsProvider: e.target.value === 'elevenlabs' ? 'elevenlabs' : 'openai',
              })
            }
          >
            <option value="openai">OpenAI TTS</option>
            <option value="elevenlabs" disabled={!elevenLabsReady}>
              ElevenLabs {!elevenLabsReady ? '(cần API key)' : ''}
            </option>
          </select>
        </div>

        {settings.ttsProvider === 'elevenlabs' ? (
          <>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="el-voice">ElevenLabs voice</label>
                <select
                  id="el-voice"
                  value={settings.elevenLabsVoiceId}
                  onChange={(e) =>
                    setSettings({ ...settings, elevenLabsVoiceId: e.target.value })
                  }
                >
                  {voices.length === 0 && (
                    <option value={settings.elevenLabsVoiceId}>
                      {settings.elevenLabsVoiceId || 'Chưa tải voice'}
                    </option>
                  )}
                  {voices.map((voice) => {
                    const accent =
                      voice.labels?.language ||
                      voice.labels?.accent ||
                      voice.labels?.locale ||
                      '';
                    return (
                      <option key={voice.voiceId} value={voice.voiceId}>
                        {voice.name}
                        {accent ? ` · ${accent}` : ''}
                        {voice.category ? ` · ${voice.category}` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="field">
                <label htmlFor="el-model">ElevenLabs model</label>
                <select
                  id="el-model"
                  value={settings.elevenLabsModelId}
                  onChange={(e) =>
                    setSettings({ ...settings, elevenLabsModelId: e.target.value })
                  }
                >
                  {ELEVENLABS_TTS_MODELS.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="hint">
              Tiếng Việt: chọn model <code>eleven_flash_v2_5</code> / <code>eleven_turbo_v2_5</code>{' '}
              / <code>eleven_v3</code> (app tự đổi nếu bạn để multilingual_v2). Giọng premade Adam/Rachel
              là giọng Anh — nên tìm voice có label Vietnamese trong Voice Library, hoặc clone giọng
              Việt. Generate lại sau khi đổi model/voice.
            </p>
          </>
        ) : (
          <>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="tts-model">OpenAI TTS model</label>
                <select
                  id="tts-model"
                  value={settings.openaiTtsModel}
                  onChange={(e) => setSettings({ ...settings, openaiTtsModel: e.target.value })}
                >
                  {OPENAI_TTS_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="tts-voice">OpenAI TTS voice</label>
                <select
                  id="tts-voice"
                  value={settings.openaiTtsVoice}
                  onChange={(e) => setSettings({ ...settings, openaiTtsVoice: e.target.value })}
                >
                  {OPENAI_TTS_VOICES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="omodel">Chat model (kịch bản)</label>
          <input
            id="omodel"
            value={settings.openaiModel}
            onChange={(e) => setSettings({ ...settings, openaiModel: e.target.value })}
          />
        </div>
      </section>

      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.burnSubtitles}
          onChange={(e) => setSettings({ ...settings, burnSubtitles: e.target.checked })}
        />
        <span>Burn-in subtitle vào video cuối</span>
      </label>

      <div className="row-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void saveAll()}>
          Lưu
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void test('snapgen')}>
          Test Snapgen
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void test('openai')}>
          Test OpenAI
        </button>
      </div>

      {msg && <div className={`msg ${msg.type === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
    </div>
  );
}
