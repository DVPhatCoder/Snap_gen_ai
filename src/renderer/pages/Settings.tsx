import { useEffect, useState } from 'react';
import type { ApiKeys, AppSettings } from '../../shared/types';
import { OPENAI_TTS_MODELS, OPENAI_TTS_VOICES } from '../../shared/types';

export default function Settings() {
  const [keys, setKeys] = useState<ApiKeys>({
    snapgenApiKey: '',
    openaiApiKey: '',
  });
  const [settings, setSettings] = useState<AppSettings>({
    openaiModel: 'gpt-4o-mini',
    openaiTtsModel: 'gpt-4o-mini-tts',
    openaiTtsVoice: 'nova',
    burnSubtitles: false,
  });
  const [msg, setMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setKeys(await window.studio.getKeys());
      setSettings(await window.studio.getSettings());
    })();
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

  const test = async (kind: 'snapgen' | 'openai') => {
    setBusy(true);
    setMsg(null);
    try {
      await window.studio.saveKeys(keys);
      const res = kind === 'snapgen' ? await window.studio.testSnapgen() : await window.studio.testOpenAI();
      setMsg({ type: res.ok ? 'ok' : 'error', text: res.message });
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
          Snapgen cho video/ảnh · OpenAI cho kịch bản, TTS voiceover và Whisper subtitle. Key lưu
          local trong userData.
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
        </div>
      </section>

      <section className="settings-block">
        <h2>OpenAI models</h2>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="omodel">Chat model (kịch bản)</label>
            <input
              id="omodel"
              value={settings.openaiModel}
              onChange={(e) => setSettings({ ...settings, openaiModel: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="tts-model">TTS model (voiceover)</label>
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
        </div>
        <div className="field">
          <label htmlFor="tts-voice">TTS voice</label>
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
      </section>

      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.burnSubtitles}
          onChange={(e) => setSettings({ ...settings, burnSubtitles: e.target.checked })}
        />
        <span>Burn-in subtitle vào video cuối (Whisper SRT)</span>
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
