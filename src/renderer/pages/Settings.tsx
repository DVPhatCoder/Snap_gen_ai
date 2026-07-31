import { useEffect, useState } from 'react';
import type {
  ApiKeys,
  AppSettings,
  ElevenLabsSessionStatus,
  UsageHistorySnapshot,
  UsageSnapshot,
} from '../../shared/types';
import { ELEVENLABS_TTS_MODELS, OPENAI_TTS_MODELS, OPENAI_TTS_VOICES } from '../../shared/types';
import UsageQuotaPanel from '../components/UsageQuotaPanel';
import UsageHistoryPanel from '../components/UsageHistoryPanel';

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
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [history, setHistory] = useState<UsageHistorySnapshot | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const elevenLabsReady = elevenLabs.loggedIn || !!elevenLabs.hasApiCredential;

  const refreshUsage = async () => {
    setUsageBusy(true);
    try {
      setUsage(await window.studio.getUsageQuotas());
      setUsageError(null);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setUsageError(
        text.includes('No handler') || text.includes('usage:getQuotas')
          ? 'Main chưa reload — gõ rs trong terminal Forge rồi bấm Làm mới.'
          : text
      );
    } finally {
      setUsageBusy(false);
    }
  };

  const refreshHistory = async () => {
    setHistoryBusy(true);
    try {
      setHistory(await window.studio.getUsageHistory());
      setHistoryError(null);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setHistoryError(
        text.includes('No handler') || text.includes('usage:getHistory')
          ? 'Main chưa reload — gõ rs trong terminal Forge rồi bấm Làm mới.'
          : text
      );
    } finally {
      setHistoryBusy(false);
    }
  };

  const loadVoices = async (force = false) => {
    if (!force && voicesLoaded) return;
    try {
      const list = await window.studio.listElevenLabsVoices();
      setVoicesLoaded(true);
      setSettings((prev) => {
        if (list.length && !list.some((v) => v.voiceId === prev.elevenLabsVoiceId)) {
          return { ...prev, elevenLabsVoiceId: list[0].voiceId };
        }
        return prev;
      });
      setMsg({ type: 'ok', text: `Đã tải ${list.length} giọng ElevenLabs (chọn trong dự án → Giọng đọc).` });
    } catch (err) {
      setVoicesLoaded(false);
      setMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
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
      await refreshUsage();
      await refreshHistory();
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
      setVoicesLoaded(false);
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
          Chọn nguồn giọng đọc và theo dõi số dư Snapgen / ElevenLabs ngay bên dưới.
        </p>
      </div>

      <UsageQuotaPanel
        snapshot={usage}
        busy={usageBusy || busy}
        error={usageError}
        onRefresh={() => void refreshUsage()}
      />

      <UsageHistoryPanel
        snapshot={history}
        busy={historyBusy || busy}
        error={historyError}
        onRefresh={() => void refreshHistory()}
        onSnapshotChange={setHistory}
      />

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
        <h2>Voiceover (mặc định dự án mới)</h2>
        <p className="settings-note">
          Chọn giọng trong từng dự án: Studio → tab <strong>Giọng đọc</strong> (hoặc khối
          «Giọng đọc theo dự án» trong AI Create). Phần dưới chỉ là mặc định khi tạo dự án mới.
        </p>
        <div className="field">
          <label htmlFor="tts-provider">Nguồn giọng mặc định</label>
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
          <div className="field">
            <label htmlFor="el-model-default">ElevenLabs model mặc định</label>
            <select
              id="el-model-default"
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
        ) : (
          <div className="grid-2">
            <div className="field">
              <label htmlFor="tts-model">OpenAI TTS model mặc định</label>
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
              <label htmlFor="tts-voice">OpenAI TTS voice mặc định</label>
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
