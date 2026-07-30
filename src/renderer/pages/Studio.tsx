import { useEffect, useMemo, useState } from 'react';
import type {
  GenerateJobResult,
  JobProgress,
  ModelOption,
  ScriptDraft,
  VideoFamily,
} from '../../shared/types';
import ModelPicker from '../components/ModelPicker';
import SceneEditor from '../components/SceneEditor';
import JobProgressView from '../components/JobProgress';
import VideoPreview from '../components/VideoPreview';

type Step = 0 | 1 | 2 | 3;

const STEP_LABELS = ['Idea', 'Script', 'Generate', 'Result'];

export default function Studio() {
  const [step, setStep] = useState<Step>(0);
  const [families, setFamilies] = useState<{ id: VideoFamily; label: string }[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [family, setFamily] = useState<VideoFamily>('veo');
  const [modelId, setModelId] = useState('veo-3.1');
  const [brief, setBrief] = useState('');
  const [language, setLanguage] = useState('Tiếng Việt');
  const [sceneCount, setSceneCount] = useState(3);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [resolution, setResolution] = useState('720p');
  const [mode, setMode] = useState('');
  const [script, setScript] = useState<ScriptDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [result, setResult] = useState<GenerateJobResult | null>(null);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === modelId),
    [models, modelId]
  );

  useEffect(() => {
    void (async () => {
      const data = await window.studio.getModels();
      setFamilies(data.families);
      setModels(data.models);
    })();
  }, []);

  useEffect(() => {
    if (!selectedModel) return;
    setAspectRatio(selectedModel.defaultAspectRatio);
    setResolution(selectedModel.defaultResolution);
    const modes = selectedModel.extraFields?.mode;
    setMode(modes?.[0] ?? '');
  }, [selectedModel?.id]);

  useEffect(() => {
    return window.studio.onJobProgress((p) => setProgress(p));
  }, []);

  const onFamilyChange = (f: VideoFamily) => {
    setFamily(f);
    const first = models.find((m) => m.family === f);
    if (first) setModelId(first.id);
  };

  const createScript = async () => {
    if (!brief.trim()) {
      setError('Nhập brief / chủ đề trước.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const draft = await window.studio.generateScript({
        brief: brief.trim(),
        language,
        sceneCount,
        family,
        model: modelId,
        aspectRatio,
        resolution,
        durationPerScene: selectedModel?.defaultDuration,
      });
      setScript(draft);
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startJob = async () => {
    if (!script) return;
    setBusy(true);
    setError(null);
    setProgress({ phase: 'idle', message: 'Bắt đầu...' });
    setStep(2);
    try {
      const res = await window.studio.startGenerate({
        projectId: `${Date.now()}`,
        script,
        family,
        model: modelId,
        aspectRatio,
        resolution,
        mode: mode || undefined,
      });
      setResult(res);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress({
        phase: 'error',
        message: 'Thất bại',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="steps">
        {STEP_LABELS.map((label, i) => (
          <div
            key={label}
            className={`step-pill ${step === i ? 'active' : ''} ${step > i ? 'done' : ''}`}
          >
            {i + 1}. {label}
          </div>
        ))}
      </div>

      {step === 0 && (
        <>
          <h1>Tạo ý tưởng video</h1>
          <p className="sub">
            ChatGPT viết kịch bản nhiều cảnh → Snapgen gen từng clip → ElevenLabs narration +
            subtitle → ghép thành video.
          </p>

          <div className="field">
            <label htmlFor="brief">Brief / chủ đề</label>
            <textarea
              id="brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Ví dụ: Video 30s giới thiệu quán cà phê view biển Đà Nẵng, tone cinematic ấm..."
            />
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="lang">Ngôn ngữ narration</label>
              <input id="lang" value={language} onChange={(e) => setLanguage(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="scenes">Số cảnh</label>
              <input
                id="scenes"
                type="number"
                min={1}
                max={12}
                value={sceneCount}
                onChange={(e) => setSceneCount(Number(e.target.value) || 1)}
              />
            </div>
          </div>

          <ModelPicker
            families={families}
            models={models}
            family={family}
            modelId={modelId}
            aspectRatio={aspectRatio}
            resolution={resolution}
            mode={mode}
            onFamilyChange={onFamilyChange}
            onModelChange={setModelId}
            onAspectRatioChange={setAspectRatio}
            onResolutionChange={setResolution}
            onModeChange={setMode}
          />

          <div className="row-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void createScript()}>
              {busy ? 'Đang tạo kịch bản...' : 'Tạo kịch bản bằng ChatGPT'}
            </button>
          </div>
        </>
      )}

      {step === 1 && script && (
        <>
          <h1>Chỉnh kịch bản</h1>
          <p className="sub">Sửa visual prompt / narration từng cảnh trước khi generate.</p>
          <SceneEditor script={script} onChange={setScript} modelId={modelId} />
          <div className="row-actions">
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setStep(0)}>
              Quay lại
            </button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void startJob()}>
              Generate video
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1>Đang generate</h1>
          <p className="sub">Pipeline: TTS → từng scene Snapgen → FFmpeg merge.</p>
          <JobProgressView progress={progress} />
        </>
      )}

      {step === 3 && result && (
        <>
          <h1>{result.title}</h1>
          <p className="sub">Video đã sẵn sàng.</p>
          <VideoPreview result={result} />
          <div className="row-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setStep(0);
                setResult(null);
                setProgress(null);
              }}
            >
              Dự án mới
            </button>
            <button type="button" className="btn" onClick={() => setStep(1)}>
              Sửa kịch bản &amp; gen lại
            </button>
          </div>
        </>
      )}

      {error && <div className="msg error">{error}</div>}
    </div>
  );
}
