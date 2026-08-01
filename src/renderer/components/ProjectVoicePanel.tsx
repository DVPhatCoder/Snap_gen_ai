import { useEffect, useState } from 'react';
import type {
  ElevenLabsSessionStatus,
  ElevenLabsVoice,
  ProjectVoiceSettings,
} from '../../shared/types';
import { ELEVENLABS_TTS_MODELS, OPENAI_TTS_MODELS, OPENAI_TTS_VOICES } from '../../shared/types';
import ElevenLabsVoicePicker from './ElevenLabsVoicePicker';

export default function ProjectVoicePanel({
  value,
  disabled,
  onChange,
}: {
  value: ProjectVoiceSettings;
  disabled?: boolean;
  onChange: (next: ProjectVoiceSettings) => void;
}) {
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [voicesBusy, setVoicesBusy] = useState(false);
  const [elevenLabs, setElevenLabs] = useState<ElevenLabsSessionStatus>({
    loggedIn: false,
    cookieCount: 0,
    hasApiCredential: false,
  });

  const elevenLabsReady = elevenLabs.loggedIn || elevenLabs.hasApiCredential;

  useEffect(() => {
    void window.studio.getElevenLabsSession().then(setElevenLabs);
    return window.studio.onElevenLabsSessionChange(setElevenLabs);
  }, []);

  useEffect(() => {
    if (!elevenLabsReady) {
      setVoices([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      setVoicesBusy(true);
      try {
        const list = await window.studio.listElevenLabsVoices();
        if (cancelled) return;
        setVoices(list);
        // Chỉ gán mặc định khi chưa có voiceId — không ghi đè giọng Library user đã chọn.
        if (list.length && !value.elevenLabsVoiceId?.trim()) {
          const premade =
            list.find((v) => (v.category || '').toLowerCase() === 'premade') || list[0];
          if (premade) onChange({ ...value, elevenLabsVoiceId: premade.voiceId });
        }
      } catch {
        if (!cancelled) setVoices([]);
      } finally {
        if (!cancelled) setVoicesBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elevenLabsReady, value.ttsProvider]);

  const patch = (partial: Partial<ProjectVoiceSettings>) => onChange({ ...value, ...partial });

  return (
    <div className="project-voice-panel">
      <div className="field">
        <label htmlFor="project-tts-provider">Nguồn giọng đọc</label>
        <select
          id="project-tts-provider"
          value={value.ttsProvider}
          disabled={disabled}
          onChange={(e) =>
            patch({
              ttsProvider: e.target.value === 'elevenlabs' ? 'elevenlabs' : 'openai',
            })
          }
        >
          <option value="openai">OpenAI TTS</option>
          <option value="elevenlabs" disabled={!elevenLabsReady}>
            ElevenLabs {!elevenLabsReady ? '(cần API key ở Settings)' : ''}
          </option>
        </select>
      </div>

      {value.ttsProvider === 'elevenlabs' ? (
        <>
          <div className="field">
            <div className="field-row-between">
              <label>ElevenLabs voice</label>
              <button
                type="button"
                className="btn ghost"
                disabled={disabled || voicesBusy || !elevenLabsReady}
                onClick={() => {
                  void (async () => {
                    setVoicesBusy(true);
                    try {
                      setVoices(await window.studio.listElevenLabsVoices());
                    } finally {
                      setVoicesBusy(false);
                    }
                  })();
                }}
              >
                {voicesBusy ? 'Đang tải…' : 'Tải lại giọng'}
              </button>
            </div>
            <ElevenLabsVoicePicker
              voices={voices}
              value={value.elevenLabsVoiceId}
              modelId={value.elevenLabsModelId}
              disabled={disabled || !elevenLabsReady || voices.length === 0}
              onChange={(voiceId) => {
                const v = voices.find((item) => item.voiceId === voiceId);
                patch({
                  elevenLabsVoiceId: voiceId,
                  elevenLabsPublicOwnerId: v?.publicOwnerId,
                  elevenLabsOriginalVoiceId: v?.originalVoiceId || voiceId,
                  elevenLabsVoiceName: v?.name,
                });
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="project-el-model">ElevenLabs model</label>
            <select
              id="project-el-model"
              value={value.elevenLabsModelId}
              disabled={disabled}
              onChange={(e) => patch({ elevenLabsModelId: e.target.value })}
            >
              {ELEVENLABS_TTS_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <div className="grid-2">
          <div className="field">
            <label htmlFor="project-tts-model">OpenAI TTS model</label>
            <select
              id="project-tts-model"
              value={value.openaiTtsModel}
              disabled={disabled}
              onChange={(e) => patch({ openaiTtsModel: e.target.value })}
            >
              {OPENAI_TTS_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="project-tts-voice">OpenAI TTS voice</label>
            <select
              id="project-tts-voice"
              value={value.openaiTtsVoice}
              disabled={disabled}
              onChange={(e) => patch({ openaiTtsVoice: e.target.value })}
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
      <p className="hint voice-save-hint">
        Giọng được lưu riêng trong dự án này. Đổi dự án = dùng đúng giọng đã chọn của dự án đó.
      </p>
    </div>
  );
}
