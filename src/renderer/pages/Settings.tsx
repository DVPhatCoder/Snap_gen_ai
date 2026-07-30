import { useEffect, useState } from 'react';
import type { ApiKeys, AppSettings } from '../../shared/types';

export default function Settings() {
  const [keys, setKeys] = useState<ApiKeys>({
    snapgenApiKey: '',
    openaiApiKey: '',
    elevenLabsApiKey: '',
  });
  const [settings, setSettings] = useState<AppSettings>({
    openaiModel: 'gpt-4o-mini',
    elevenLabsVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
    burnSubtitles: false,
  });
  const [voices, setVoices] = useState<{ voice_id: string; name: string }[]>([]);
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
      setMsg({ type: 'ok', text: 'Đã lưu API keys và settings trên máy (encrypted nếu hệ thống hỗ trợ).' });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const test = async (kind: 'snapgen' | 'openai' | 'eleven') => {
    setBusy(true);
    setMsg(null);
    try {
      await window.studio.saveKeys(keys);
      const res =
        kind === 'snapgen'
          ? await window.studio.testSnapgen()
          : kind === 'openai'
            ? await window.studio.testOpenAI()
            : await window.studio.testElevenLabs();
      setMsg({ type: res.ok ? 'ok' : 'error', text: res.message });
      if (kind === 'eleven' && res.ok) {
        setVoices(await window.studio.listVoices());
      }
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h1>Cấu hình API Keys</h1>
      <p className="sub">
        Nhập key trực tiếp trên giao diện — không cần sửa file .env. Key được lưu local trong userData
        của Electron.
      </p>

      <div className="field">
        <label htmlFor="snapgen">Snapgen API Key (x-api-key)</label>
        <input
          id="snapgen"
          type="password"
          value={keys.snapgenApiKey}
          onChange={(e) => setKeys({ ...keys, snapgenApiKey: e.target.value })}
          placeholder="sk_..."
        />
      </div>
      <div className="field">
        <label htmlFor="openai">OpenAI API Key (ChatGPT kịch bản)</label>
        <input
          id="openai"
          type="password"
          value={keys.openaiApiKey}
          onChange={(e) => setKeys({ ...keys, openaiApiKey: e.target.value })}
          placeholder="sk-..."
        />
      </div>
      <div className="field">
        <label htmlFor="eleven">ElevenLabs API Key (voice + subs)</label>
        <input
          id="eleven"
          type="password"
          value={keys.elevenLabsApiKey}
          onChange={(e) => setKeys({ ...keys, elevenLabsApiKey: e.target.value })}
          placeholder="xi-..."
        />
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="omodel">OpenAI model</label>
          <input
            id="omodel"
            value={settings.openaiModel}
            onChange={(e) => setSettings({ ...settings, openaiModel: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="voice">ElevenLabs Voice ID</label>
          <input
            id="voice"
            value={settings.elevenLabsVoiceId}
            onChange={(e) => setSettings({ ...settings, elevenLabsVoiceId: e.target.value })}
            list="voice-list"
          />
          <datalist id="voice-list">
            {voices.map((v) => (
              <option key={v.voice_id} value={v.voice_id}>
                {v.name}
              </option>
            ))}
          </datalist>
        </div>
      </div>

      <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input
          type="checkbox"
          checked={settings.burnSubtitles}
          onChange={(e) => setSettings({ ...settings, burnSubtitles: e.target.checked })}
        />
        Burn-in subtitles vào video cuối (thay vì chỉ file .srt)
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
        <button type="button" className="btn" disabled={busy} onClick={() => void test('eleven')}>
          Test ElevenLabs
        </button>
      </div>

      {msg && <div className={`msg ${msg.type === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
    </div>
  );
}
