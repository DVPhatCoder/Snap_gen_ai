import { useEffect, useMemo, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type {
  ExportMode,
  GenerateJobResult,
  ImageFamily,
  JobProgress,
  MediaKind,
  ModelOption,
  SceneMediaAsset,
  ScriptDraft,
  VideoFamily,
} from '../../shared/types';
import ModelPicker from '../components/ModelPicker';
import JobProgressView from '../components/JobProgress';
import Timeline from '../components/Timeline';
import ExportDialog, { buildExportableScenes } from '../components/ExportDialog';
import GenerateScenesDialog from '../components/GenerateScenesDialog';

type Tool = 'ai' | 'script' | 'media' | 'audio' | 'text';

interface Props {
  projectId: string | null;
  onProjectReady: (id: string) => void;
  onNeedProject: () => void;
}

const TOOL_ITEMS: Array<{ id: Tool; icon: string; label: string }> = [
  { id: 'ai', icon: '✦', label: 'AI Create' },
  { id: 'media', icon: '▧', label: 'Media' },
  { id: 'script', icon: '☷', label: 'Script' },
  { id: 'audio', icon: '♫', label: 'Audio' },
  { id: 'text', icon: 'T', label: 'Text' },
];

function toFileUrl(filePath: string): string {
  return `file:///${filePath.replace(/\\/g, '/')}`;
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function Studio({ projectId, onProjectReady, onNeedProject }: Props) {
  const [activeTool, setActiveTool] = useState<Tool>('ai');
  const [videoFamilies, setVideoFamilies] = useState<{ id: VideoFamily; label: string }[]>([]);
  const [imageFamilies, setImageFamilies] = useState<{ id: ImageFamily; label: string }[]>([]);
  const [videoModels, setVideoModels] = useState<ModelOption[]>([]);
  const [imageModels, setImageModels] = useState<ModelOption[]>([]);
  const [projectName, setProjectName] = useState('Untitled project');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(projectId);
  const [mediaKind, setMediaKind] = useState<MediaKind>('video');
  const [family, setFamily] = useState<string>('veo');
  const [modelId, setModelId] = useState('veo-3.1');
  const [brief, setBrief] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [language, setLanguage] = useState('Tiếng Việt');
  const [sceneCount, setSceneCount] = useState(3);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [resolution, setResolution] = useState('720p');
  const [mode, setMode] = useState('');
  const [script, setScript] = useState<ScriptDraft | null>(null);
  const [sceneMedia, setSceneMedia] = useState<SceneMediaAsset[]>([]);
  const [selectedScene, setSelectedScene] = useState(0);
  const [previewMode, setPreviewMode] = useState<'scene' | 'final'>('scene');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [result, setResult] = useState<GenerateJobResult | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(72);
  const [timelineDirty, setTimelineDirty] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [hasNarration, setHasNarration] = useState(false);
  const remuxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remuxRunning = useRef(false);
  const remuxPending = useRef<ScriptDraft | null>(null);

  const hasSceneMedia = sceneMedia.some((asset) => asset.exists);
  const canRemux = Boolean(activeProjectId && script?.scenes.length && hasSceneMedia);

  const models = mediaKind === 'image' ? imageModels : videoModels;
  const families = mediaKind === 'image' ? imageFamilies : videoFamilies;
  const selectedModel = useMemo(
    () => models.find((item) => item.id === modelId),
    [models, modelId]
  );
  const currentScene = script?.scenes[selectedScene] ?? null;
  const currentAsset =
    sceneMedia.find((asset) => asset.sceneId === currentScene?.id) ??
    sceneMedia[selectedScene] ??
    null;
  const totalDuration = useMemo(
    () => script?.scenes.reduce((sum, scene) => sum + scene.duration_hint, 0) ?? 0,
    [script]
  );
  const sceneOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const scene of script?.scenes ?? []) {
      offsets.push(acc);
      acc += scene.duration_hint;
    }
    return offsets;
  }, [script]);
  const playableSrc =
    previewMode === 'final' && result
      ? result.videoPath
      : previewMode === 'scene' && currentAsset?.exists && currentAsset.kind === 'video'
        ? currentAsset.path
        : null;
  const sceneTotal = script?.scenes.length ?? 0;
  const canStepScene = sceneTotal > 1;

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const stepScene = (delta: number) => {
    if (!sceneTotal) return;
    const next = Math.min(sceneTotal - 1, Math.max(0, selectedScene + delta));
    if (next === selectedScene) return;
    setSelectedScene(next);
    if (previewMode === 'final' && videoRef.current) {
      videoRef.current.currentTime = Math.min(
        Math.max(0, sceneOffsets[next] ?? 0),
        Math.max(0, (videoRef.current.duration || totalDuration) - 0.05)
      );
    }
  };

  const videoEvents = {
    ref: videoRef,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) =>
      setCurrentTime(event.currentTarget.currentTime),
    onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => {
      const value = event.currentTarget.duration;
      setMediaDuration(Number.isFinite(value) ? value : 0);
      setCurrentTime(0);
    },
  };

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setMediaDuration(0);
  }, [playableSrc]);

  // `timeupdate` only fires a few times per second, which makes the playhead
  // stutter; sample the element directly while it plays.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 33) return;
      last = now;
      const video = videoRef.current;
      if (video) setCurrentTime(video.currentTime);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // The rendered clips can drift a little from their planned duration, so map
  // playback progress proportionally onto the timeline the user sees.
  const playheadTime = useMemo(() => {
    if (!playableSrc || mediaDuration <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, currentTime / mediaDuration));
    if (previewMode === 'final') return ratio * totalDuration;
    const sceneDuration = script?.scenes[selectedScene]?.duration_hint ?? 0;
    return (sceneOffsets[selectedScene] ?? 0) + ratio * sceneDuration;
  }, [
    playableSrc,
    mediaDuration,
    currentTime,
    previewMode,
    totalDuration,
    script,
    selectedScene,
    sceneOffsets,
  ]);

  const seekToTimelineTime = (seconds: number) => {
    if (!script?.scenes.length) return;
    let elapsed = 0;
    let index = script.scenes.length - 1;
    for (let i = 0; i < script.scenes.length; i++) {
      const duration = script.scenes[i].duration_hint;
      if (seconds < elapsed + duration) {
        index = i;
        break;
      }
      elapsed += duration;
    }
    const video = videoRef.current;
    if (previewMode === 'final' && video && totalDuration > 0) {
      const ratio = Math.min(1, Math.max(0, seconds / totalDuration));
      video.currentTime = ratio * (video.duration || totalDuration);
      setSelectedScene(index);
      return;
    }
    setSelectedScene(index);
  };

  useEffect(() => {
    void (async () => {
      const data = await window.studio.getModels();
      setVideoFamilies(data.videoFamilies);
      setImageFamilies(data.imageFamilies);
      setVideoModels(data.videoModels);
      setImageModels(data.imageModels);
    })();
  }, []);

  useEffect(() => window.studio.onJobProgress(setProgress), []);

  useEffect(() => {
    return () => {
      if (remuxTimer.current) clearTimeout(remuxTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const detail = await window.studio.getProject(projectId);
        setSceneMedia(detail.sceneMedia);
        setHasNarration(Boolean(detail.audioPath));
        setActiveProjectId(detail.meta.id);
        setProjectName(detail.meta.name);
        const draft = detail.draft;
        if (draft) {
          setBrief(draft.brief);
          setLanguage(draft.language);
          setSceneCount(draft.sceneCount);
          setMediaKind(draft.mediaKind ?? 'video');
          setFamily(draft.family);
          setModelId(draft.model);
          setAspectRatio(draft.aspectRatio);
          setResolution(draft.resolution);
          setMode(draft.mode ?? '');
          setStylePrompt(draft.stylePrompt ?? '');
          setScript(draft.script);
          if (draft.script) setActiveTool('script');
        }
        if (detail.videoPath) {
          setResult({
            projectId: detail.meta.id,
            projectName: detail.meta.name,
            projectDir: detail.projectDir,
            videoPath: detail.videoPath,
            srtPath: detail.srtPath ?? detail.videoPath.replace(/\.mp4$/i, '.srt'),
            audioPath: detail.audioPath ?? '',
            title: draft?.script?.title ?? detail.meta.name,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    })();
  }, [projectId]);

  useEffect(() => {
    if (!script?.scenes.length) setSelectedScene(0);
    else if (selectedScene >= script.scenes.length) setSelectedScene(script.scenes.length - 1);
  }, [script, selectedScene]);

  const applyKindDefaults = (kind: MediaKind) => {
    setMediaKind(kind);
    const pool = kind === 'image' ? imageModels : videoModels;
    const first = pool[0];
    if (first) {
      setFamily(first.family);
      setModelId(first.id);
      setAspectRatio(first.defaultAspectRatio);
      setResolution(first.defaultResolution);
      setMode(first.extraFields?.mode?.[0] ?? '');
      return;
    }
    setFamily(kind === 'image' ? 'gpt-image' : 'veo');
    setModelId(kind === 'image' ? 'gpt-image-2' : 'veo-3.1');
    setAspectRatio('16:9');
    setResolution(kind === 'image' ? '2k' : '720p');
  };

  const onFamilyChange = (nextFamily: VideoFamily | ImageFamily) => {
    setFamily(nextFamily);
    const first = models.find((item) => item.family === nextFamily);
    if (!first) return;
    setModelId(first.id);
    setAspectRatio(first.defaultAspectRatio);
    setResolution(first.defaultResolution);
    setMode(first.extraFields?.mode?.[0] ?? '');
  };

  const onModelChange = (id: string) => {
    setModelId(id);
    const selected = models.find((item) => item.id === id);
    if (!selected) return;
    setAspectRatio(selected.defaultAspectRatio);
    setResolution(selected.defaultResolution);
    setMode(selected.extraFields?.mode?.[0] ?? '');
  };

  const draftPayload = (nextScript: ScriptDraft | null = script) => ({
    brief,
    language,
    sceneCount,
    family: family as VideoFamily | ImageFamily,
    model: modelId,
    aspectRatio,
    resolution,
    mode: mode || undefined,
    script: nextScript,
    mediaKind,
    stylePrompt,
  });

  const ensureProject = async (): Promise<string> => {
    const name = projectName.trim() || 'Untitled project';
    if (activeProjectId) {
      await window.studio.renameProject(activeProjectId, name);
      await window.studio.saveProjectDraft(activeProjectId, draftPayload(), { name });
      return activeProjectId;
    }
    const meta = await window.studio.createProject({
      name,
      brief,
      language,
      sceneCount,
      family: family as VideoFamily | ImageFamily,
      model: modelId,
      aspectRatio,
      resolution,
      mode: mode || undefined,
      mediaKind,
      stylePrompt,
    });
    setActiveProjectId(meta.id);
    onProjectReady(meta.id);
    return meta.id;
  };

  const persistScript = async (nextScript: ScriptDraft) => {
    setScript(nextScript);
    if (activeProjectId) {
      await window.studio.saveProjectDraft(activeProjectId, draftPayload(nextScript), {
        name: projectName.trim() || 'Untitled project',
      });
    }
  };

  const updateScene = (patch: Partial<ScriptDraft['scenes'][number]>) => {
    if (!script || !currentScene) return;
    const scenes = script.scenes.map((scene, index) =>
      index === selectedScene ? { ...scene, ...patch } : scene
    );
    const next = {
      ...script,
      scenes,
      narration: scenes.map((scene) => scene.narration_segment).join(' '),
    };
    void persistScript(next);
    if (patch.duration_hint != null && result) {
      scheduleRemux(next);
    }
  };

  const applyTimeline = async (nextScript: ScriptDraft) => {
    if (!activeProjectId) return;
    // Remux only needs the scene clips plus narration on disk — a previous
    // final.mp4 is not required.
    if (!hasSceneMedia) {
      setToast({
        type: 'error',
        text: 'Chưa có clip nào để ghép. Hãy Generate trước.',
      });
      return;
    }
    if (remuxTimer.current) {
      clearTimeout(remuxTimer.current);
      remuxTimer.current = null;
    }
    // Two ffmpeg runs would write the same final.mp4 and work/ files at once,
    // so queue the newest script instead of starting a second pass.
    if (remuxRunning.current) {
      remuxPending.current = nextScript;
      return;
    }
    remuxRunning.current = true;
    setBusy(true);
    setTimelineDirty(true);
    setError(null);
    setProgress({
      phase: 'merge',
      message: 'Đang ghép lại video bằng FFmpeg (không gọi API)...',
      percent: 80,
    });
    try {
      await window.studio.saveProjectDraft(activeProjectId, draftPayload(nextScript), {
        name: projectName.trim() || 'Untitled project',
      });
      const remuxed = await window.studio.remuxProject(activeProjectId);
      setResult(remuxed);
      const refreshed = await window.studio.getProject(activeProjectId);
      setSceneMedia(refreshed.sceneMedia);
      if (refreshed.draft?.script) {
        setScript(refreshed.draft.script);
        setSceneCount(refreshed.draft.script.scenes.length);
      }
      setPreviewMode('final');
      setPreviewKey((value) => value + 1);
      setTimelineDirty(false);
      setToast({ type: 'ok', text: 'Đã ghép lại video theo timeline (FFmpeg local).' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setToast({ type: 'error', text: message });
    } finally {
      remuxRunning.current = false;
      setBusy(false);
      setProgress(null);
      const queued = remuxPending.current;
      if (queued) {
        remuxPending.current = null;
        void applyTimeline(queued);
      }
    }
  };

  const scheduleRemux = (nextScript: ScriptDraft) => {
    if (!activeProjectId) return;
    setTimelineDirty(true);
    if (!hasSceneMedia) return;
    if (remuxTimer.current) clearTimeout(remuxTimer.current);
    remuxTimer.current = setTimeout(() => {
      void applyTimeline(nextScript);
    }, 450);
  };

  const reorderScenes = (from: number, to: number) => {
    if (!script || from === to) return;
    const scenes = [...script.scenes];
    const [moved] = scenes.splice(from, 1);
    scenes.splice(to, 0, moved);
    const next = {
      ...script,
      scenes,
      narration: scenes.map((scene) => scene.narration_segment).join(' '),
    };
    setSelectedScene(to);
    setScript(next);
    scheduleRemux(next);
  };

  /** Live preview while dragging the clip edge — no remux yet. */
  const changeSceneDuration = (index: number, duration: number) => {
    if (!script) return;
    const scenes = script.scenes.map((scene, i) =>
      i === index ? { ...scene, duration_hint: Math.max(1, duration) } : scene
    );
    setScript({ ...script, scenes });
    setTimelineDirty(true);
  };

  /** Fired when the user releases the resize handle — persist + remux. */
  const commitSceneDuration = (index: number, duration: number) => {
    if (!script) return;
    const scenes = script.scenes.map((scene, i) =>
      i === index ? { ...scene, duration_hint: Math.max(1, duration) } : scene
    );
    const next = { ...script, scenes };
    setScript(next);
    scheduleRemux(next);
  };

  const exportVideo = async () => {
    const hasScenes = buildExportableScenes(script, sceneMedia).length > 0;
    if (!result && !hasScenes) {
      setToast({ type: 'error', text: 'Chưa có media để lưu. Hãy Generate trước.' });
      return;
    }
    setExportOpen(true);
  };

  const confirmExport = async (payload: { mode: ExportMode; selectedSceneIds: string[] }) => {
    setBusy(true);
    setError(null);
    try {
      const baseName = projectName.trim() || result?.title || 'snapgen';
      if (payload.mode === 'final') {
        if (!result?.videoPath) {
          throw new Error('Chưa có bản Final để lưu.');
        }
        const saved = await window.studio.exportMedia({
          mode: 'final',
          final: {
            sourcePath: result.videoPath,
            suggestedName: baseName,
          },
        });
        if (saved) {
          setToast({ type: 'ok', text: `Đã lưu Final: ${saved.path}` });
          setExportOpen(false);
        }
        return;
      }

      const exportable = buildExportableScenes(script, sceneMedia);
      const chosen = exportable.filter((item) => payload.selectedSceneIds.includes(item.sceneId));
      if (!chosen.length) {
        throw new Error('Chọn ít nhất một phân cảnh.');
      }

      const saved = await window.studio.exportMedia({
        mode: 'scenes',
        scenes: chosen.map((item) => {
          const ext = item.kind === 'image' ? 'png' : 'mp4';
          const index = String(item.index + 1).padStart(2, '0');
          return {
            sourcePath: item.path,
            fileName: `${baseName}-scene-${index}.${ext}`,
          };
        }),
      });
      if (saved) {
        setToast({
          type: 'ok',
          text: `Đã lưu ${saved.files?.length ?? chosen.length} phân cảnh vào: ${saved.path}`,
        });
        setExportOpen(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setToast({ type: 'error', text: message });
    } finally {
      setBusy(false);
    }
  };

  const createScript = async () => {
    if (!brief.trim()) {
      setError('Nhập brief / chủ đề trước.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await ensureProject();
      const draft = await window.studio.generateScript({
        brief: brief.trim(),
        language,
        sceneCount,
        family: family as VideoFamily | ImageFamily,
        model: modelId,
        aspectRatio,
        resolution,
        durationPerScene: selectedModel?.defaultDuration,
        mediaKind,
        stylePrompt: stylePrompt.trim() || undefined,
      });
      setScript(draft);
      setSelectedScene(0);
      await window.studio.saveProjectDraft(id, draftPayload(draft), {
        name: projectName.trim() || 'Untitled project',
      });
      setActiveTool('script');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startJob = async () => {
    if (!script) {
      setActiveTool('ai');
      setError('Hãy tạo kịch bản trước khi generate.');
      return;
    }
    setGenerateOpen(true);
  };

  const confirmGenerate = async (payload: {
    regenerateSceneIds: string[];
    refreshNarration: boolean;
  }) => {
    if (!script) return;
    setBusy(true);
    setError(null);
    setProgress({ phase: 'idle', message: 'Đang chuẩn bị pipeline...', percent: 0 });
    try {
      const id = await ensureProject();
      await window.studio.saveProjectDraft(id, draftPayload(script), {
        name: projectName.trim() || 'Untitled project',
      });
      const generated = await window.studio.startGenerate({
        projectId: id,
        projectName: projectName.trim() || 'Untitled project',
        script,
        family: family as VideoFamily | ImageFamily,
        model: modelId,
        aspectRatio,
        resolution,
        mode: mode || undefined,
        brief,
        language,
        mediaKind,
        stylePrompt: stylePrompt.trim() || undefined,
        regenerateSceneIds: payload.regenerateSceneIds,
        refreshNarration: payload.refreshNarration,
      });
      setResult(generated);
      setHasNarration(Boolean(generated.audioPath));
      const refreshed = await window.studio.getProject(id);
      setSceneMedia(refreshed.sceneMedia);
      if (refreshed.draft?.script) {
        setScript(refreshed.draft.script);
        setSceneCount(refreshed.draft.script.scenes.length);
      }
      setPreviewMode('scene');
      setPreviewKey((value) => value + 1);
      setProgress(null);
      setGenerateOpen(false);
      setToast({
        type: 'ok',
        text: `Đã generate ${payload.regenerateSceneIds.length} scene và ghép Final (voiceover sync từng scene).`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setProgress({ phase: 'error', message: 'Generate thất bại', error: message });
      setToast({ type: 'error', text: message });
    } finally {
      setBusy(false);
    }
  };

  const renderLeftPanel = () => {
    if (activeTool === 'ai') {
      return (
        <>
          <div className="editor-panel-heading">
            <div>
              <span className="panel-kicker">AI WORKFLOW</span>
              <h2>Create with AI</h2>
            </div>
            <span className="beta-badge">BETA</span>
          </div>

          <div className="media-switch">
            <button
              type="button"
              className={mediaKind === 'video' ? 'active' : ''}
              onClick={() => applyKindDefaults('video')}
            >
              Video
            </button>
            <button
              type="button"
              className={mediaKind === 'image' ? 'active' : ''}
              onClick={() => applyKindDefaults('image')}
            >
              Image
            </button>
          </div>

          <div className="field compact-field">
            <label htmlFor="brief">Describe your video</label>
            <textarea
              id="brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="A 30-second cinematic coffee shop story by the sea..."
            />
          </div>
          <div className="field compact-field">
            <label htmlFor="style">Visual style</label>
            <textarea
              id="style"
              className="small-textarea"
              value={stylePrompt}
              onChange={(event) => setStylePrompt(event.target.value)}
              placeholder="Warm film look, soft light, consistent character..."
            />
          </div>
          <div className="field-row">
            <div className="field compact-field">
              <label htmlFor="language">Language</label>
              <input
                id="language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              />
            </div>
            <div className="field compact-field short-field">
              <label htmlFor="scene-count">Scenes</label>
              <input
                id="scene-count"
                type="number"
                min={1}
                value={sceneCount}
                onChange={(event) =>
                  setSceneCount(Math.max(1, Number(event.target.value) || 1))
                }
              />
            </div>
          </div>
          {sceneCount > 12 && (
            <p className="hint">
              Nhiều scene hơn → chi phí Snapgen + TTS tăng tương ứng. Mỗi scene là một clip riêng.
            </p>
          )}
          <ModelPicker
            mediaKind={mediaKind}
            families={families}
            models={models}
            family={family}
            modelId={modelId}
            aspectRatio={aspectRatio}
            resolution={resolution}
            mode={mode}
            onFamilyChange={onFamilyChange}
            onModelChange={onModelChange}
            onAspectRatioChange={setAspectRatio}
            onResolutionChange={setResolution}
            onModeChange={setMode}
          />
          <button
            type="button"
            className="editor-primary full-width"
            disabled={busy}
            onClick={() => void createScript()}
          >
            <span>✦</span>
            {busy ? 'Creating script...' : 'Generate script'}
          </button>
        </>
      );
    }

    if (activeTool === 'script') {
      return (
        <>
          <div className="editor-panel-heading">
            <div>
              <span className="panel-kicker">STORYBOARD</span>
              <h2>Scenes</h2>
            </div>
            <span className="scene-count">{script?.scenes.length ?? 0}</span>
          </div>
          {script ? (
            <div className="scene-list">
              {script.scenes.map((scene, index) => (
                <button
                  type="button"
                  key={scene.id}
                  className={`scene-list-item ${selectedScene === index ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedScene(index);
                    setPreviewMode('scene');
                  }}
                >
                  <span className="scene-thumb">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                  </span>
                  <span className="scene-list-copy">
                    <strong>Scene {index + 1}</strong>
                    <small>{scene.visual_prompt || 'Empty visual prompt'}</small>
                  </span>
                  <span className="scene-duration">{scene.duration_hint}s</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-panel">
              <span>☷</span>
              <strong>No scenes yet</strong>
              <p>Create a script with AI to build your timeline.</p>
              <button type="button" className="editor-secondary" onClick={() => setActiveTool('ai')}>
                Open AI Create
              </button>
            </div>
          )}
        </>
      );
    }

    if (activeTool === 'media') {
      const readyAssets = sceneMedia.filter((asset) => asset.exists);
      return (
        <>
          <div className="editor-panel-heading">
            <div>
              <span className="panel-kicker">PROJECT MEDIA</span>
              <h2>Scene clips</h2>
            </div>
            <span className="scene-count">{readyAssets.length}</span>
          </div>
          <p className="media-note">
            Mỗi scene là một file riêng. Chọn clip để preview hoặc mở thư mục dự án.
          </p>
          {readyAssets.length ? (
            <div className="media-grid">
              {sceneMedia.map((asset, index) => {
                const scene = script?.scenes[index];
                return (
                  <button
                    type="button"
                    key={asset.sceneId}
                    className={`media-card ${selectedScene === index ? 'active' : ''}`}
                    disabled={!asset.exists}
                    onClick={() => {
                      setSelectedScene(index);
                      setPreviewMode('scene');
                    }}
                  >
                    <span className="media-card-preview">
                      <span>{asset.kind === 'video' ? '▶' : '▧'}</span>
                      <small>{String(index + 1).padStart(2, '0')}</small>
                    </span>
                    <span className="media-card-copy">
                      <strong>Scene {index + 1}</strong>
                      <small>{scene?.duration_hint ?? 0}s · {fileName(asset.path)}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="upload-dropzone">
              <span>＋</span>
              <strong>Chưa có clip scene</strong>
              <p>Generate sẽ tạo một file riêng cho từng scene.</p>
            </div>
          )}
          {result && (
            <button
              type="button"
              className="editor-secondary full-width media-folder-button"
              onClick={() => void window.studio.showItemInFolder(result.videoPath)}
            >
              Mở thư mục chứa clips
            </button>
          )}
        </>
      );
    }

    return (
      <>
        <div className="editor-panel-heading">
          <div>
            <span className="panel-kicker">{activeTool.toUpperCase()}</span>
            <h2>{activeTool === 'audio' ? 'Audio' : 'Text'}</h2>
          </div>
        </div>
        <div className="upload-dropzone">
          <span>{activeTool === 'audio' ? '♫' : activeTool === 'text' ? 'T' : '＋'}</span>
          <strong>
            {activeTool === 'audio' ? 'Voiceover by OpenAI' : 'Captions by Whisper'}
          </strong>
          <p>
            This track will be created automatically during generation.
          </p>
        </div>
      </>
    );
  };

  return (
    <div className="editor-page">
      <header className="editor-commandbar">
        <div className="editor-command-left">
          <button type="button" className="icon-button" onClick={onNeedProject} title="Back to projects">
            ‹
          </button>
          <input
            className="project-title-input"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            aria-label="Project name"
          />
          <span className="save-state">Saved</span>
        </div>
        <div className="editor-history">
          <button type="button" className="icon-button" title="Undo" disabled>
            ↶
          </button>
          <button type="button" className="icon-button" title="Redo" disabled>
            ↷
          </button>
          <span className="history-divider" />
          <button type="button" className="icon-button" title="Keyboard shortcuts">
            ⌨
          </button>
        </div>
        <div className="editor-command-right">
          {canRemux && (
            <button
              type="button"
              className={`editor-secondary remux-button ${timelineDirty ? 'dirty' : ''}`.trim()}
              disabled={busy}
              onClick={() => script && void applyTimeline(script)}
              title="Ghép lại final.mp4 từ các clip hiện có bằng FFmpeg (không tốn API)"
            >
              {busy ? 'Đang ghép...' : timelineDirty ? 'Ghép lại video ●' : 'Ghép lại video'}
            </button>
          )}
          <button
            type="button"
            className="editor-secondary"
            disabled={busy || (!result && !hasSceneMedia)}
            onClick={() => void exportVideo()}
          >
            Lưu video...
          </button>
          <button type="button" className="editor-primary" disabled={busy} onClick={() => void startJob()}>
            <span>✦</span>
            {busy ? 'Generating...' : result ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </header>

      <div className="editor-workspace">
        <aside className="tool-rail">
          {TOOL_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={activeTool === item.id ? 'active' : ''}
              onClick={() => setActiveTool(item.id)}
              title={item.label}
            >
              <span className="tool-icon">{item.icon}</span>
              <small>{item.label}</small>
            </button>
          ))}
        </aside>

        <aside className="asset-panel">{renderLeftPanel()}</aside>

        <main className="viewer-panel">
          <div className="viewer-toolbar">
            <div className="preview-mode-switch">
              <button
                type="button"
                className={previewMode === 'scene' ? 'active' : ''}
                disabled={!currentAsset?.exists}
                onClick={() => setPreviewMode('scene')}
              >
                Scene {selectedScene + 1}
              </button>
              <button
                type="button"
                className={previewMode === 'final' ? 'active' : ''}
                disabled={!result}
                onClick={() => setPreviewMode('final')}
              >
                Final
              </button>
            </div>
            <div>
              <button type="button" className="viewer-chip">{aspectRatio}</button>
              <button type="button" className="viewer-chip">Fit</button>
              <button type="button" className="icon-button">•••</button>
            </div>
          </div>
          <div className="viewer-stage">
            <div className={`preview-canvas ratio-${aspectRatio.replace(':', '-')}`}>
              {previewMode === 'scene' && currentAsset?.exists && currentAsset.kind === 'video' ? (
                <video
                  key={`${currentAsset.path}-${selectedScene}-${previewKey}`}
                  className="editor-video"
                  controls
                  src={toFileUrl(currentAsset.path)}
                  {...videoEvents}
                />
              ) : previewMode === 'scene' && currentAsset?.exists ? (
                <img
                  className="editor-video"
                  src={toFileUrl(currentAsset.path)}
                  alt={`Scene ${selectedScene + 1}`}
                />
              ) : previewMode === 'final' && result ? (
                <video
                  key={previewKey}
                  className="editor-video"
                  controls
                  src={toFileUrl(result.videoPath)}
                  {...videoEvents}
                />
              ) : currentScene ? (
                <div className="scene-preview-placeholder">
                  <span className="preview-index">SCENE {selectedScene + 1}</span>
                  <div className="preview-orb" />
                  <h3>{script?.title}</h3>
                  <p>{currentScene.visual_prompt}</p>
                  <span className="preview-style">{stylePrompt || 'AI visual preview'}</span>
                </div>
              ) : (
                <div className="viewer-empty">
                  <div className="empty-play">▶</div>
                  <strong>Your preview will appear here</strong>
                  <p>Describe an idea and generate a storyboard to begin.</p>
                </div>
              )}
            </div>
          </div>
          <div className="playback-controls">
            <span>{formatTime(playableSrc ? currentTime : 0)}</span>
            <div>
              <button
                type="button"
                className="icon-button"
                title="Scene trước"
                disabled={!canStepScene || selectedScene === 0}
                onClick={() => stepScene(-1)}
              >
                |◀
              </button>
              <button
                type="button"
                className="play-button"
                title={playing ? 'Tạm dừng' : 'Phát'}
                disabled={!playableSrc}
                onClick={togglePlay}
              >
                {playing ? 'Ⅱ' : '▶'}
              </button>
              <button
                type="button"
                className="icon-button"
                title="Scene kế tiếp"
                disabled={!canStepScene || selectedScene >= sceneTotal - 1}
                onClick={() => stepScene(1)}
              >
                ▶|
              </button>
            </div>
            <span>{formatTime(playableSrc && mediaDuration ? mediaDuration : totalDuration)}</span>
          </div>
          {busy && progress && (
            <div className="generation-overlay">
              <JobProgressView progress={progress} />
            </div>
          )}
        </main>

        <aside className="inspector-panel">
          <div className="inspector-tabs">
            <button type="button" className="active">Basic</button>
            <button type="button">AI</button>
          </div>
          {currentScene ? (
            <div className="inspector-content">
              <div className="inspector-section">
                <div className="inspector-title">
                  <strong>Scene {selectedScene + 1}</strong>
                  <span>{currentScene.duration_hint.toFixed(1)}s</span>
                </div>
                <div className="field compact-field">
                  <label>Visual prompt</label>
                  <textarea
                    value={currentScene.visual_prompt}
                    onChange={(event) => updateScene({ visual_prompt: event.target.value })}
                  />
                </div>
                <div className="field compact-field">
                  <label>Narration</label>
                  <textarea
                    className="small-textarea"
                    value={currentScene.narration_segment}
                    onChange={(event) => updateScene({ narration_segment: event.target.value })}
                  />
                </div>
              </div>
              <div className="inspector-section">
                <div className="inspector-title">
                  <strong>Timing</strong>
                </div>
                <div className="property-row">
                  <label>Duration</label>
                  <div className="property-input">
                    <input
                      type="number"
                      min={1}
                      max={60}
                      step={0.1}
                      value={Number(currentScene.duration_hint.toFixed(1))}
                      onChange={(event) =>
                        updateScene({
                          duration_hint: Math.min(
                            60,
                            Math.max(1, Number(event.target.value) || 1)
                          ),
                        })
                      }
                    />
                    <span>s</span>
                  </div>
                </div>
                <p className="hint">
                  Thời lượng bám theo đoạn lời thoại của scene. Sửa Narration rồi tạo lại
                  voiceover để đổi độ dài.
                </p>
                {selectedModel &&
                  currentScene.duration_hint > Math.max(...selectedModel.durations) && (
                    <p className="hint">
                      Cảnh dài → extend trong cảnh này. Cảnh kế tiếp vẫn gen mới (hard cut).
                    </p>
                  )}
              </div>
              <div className="inspector-section">
                <div className="inspector-title">
                  <strong>Project style</strong>
                </div>
                <div className="field compact-field">
                  <textarea
                    className="small-textarea"
                    value={stylePrompt}
                    onChange={(event) => setStylePrompt(event.target.value)}
                    placeholder="No style guide"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="inspector-empty">
              <span>◇</span>
              <strong>Nothing selected</strong>
              <p>Select a scene on the timeline to edit its properties.</p>
            </div>
          )}
        </aside>

        <section className="timeline-panel">
          <div className="timeline-toolbar">
            <div className="timeline-tools">
              <button type="button" className="icon-button active" title="Select / kéo thả">
                ↖
              </button>
              <span className="timeline-hint">
                Kéo clip để đổi thứ tự · Kéo cạnh phải để đổi thời lượng · Thả ra sẽ ghép lại video (FFmpeg)
              </span>
            </div>
            <div className="timeline-status">
              <span>{script?.scenes.length ?? 0} scenes</span>
              <span>·</span>
              <span>{formatTime(totalDuration)}</span>
              {timelineDirty && (
                <span className="dirty-dot">
                  ● {busy ? 'đang ghép lại...' : 'chưa ghép lại'}
                </span>
              )}
            </div>
            <div className="timeline-zoom">
              <span>−</span>
              <input
                type="range"
                min={45}
                max={120}
                value={timelineZoom}
                onChange={(event) => setTimelineZoom(Number(event.target.value))}
              />
              <span>＋</span>
            </div>
          </div>
          <Timeline
            script={script}
            selectedScene={selectedScene}
            timelineZoom={timelineZoom}
            playheadTime={playheadTime}
            onSelect={(index) => {
              setSelectedScene(index);
              setActiveTool('script');
              setPreviewMode('scene');
            }}
            onReorder={reorderScenes}
            onDurationChange={changeSceneDuration}
            onDurationCommit={commitSceneDuration}
            onSeek={seekToTimelineTime}
          />
        </section>
      </div>

      {(error || toast) && (
        <div className={`editor-toast ${toast?.type === 'ok' ? 'ok' : 'error'}`}>
          <span>{toast?.type === 'ok' ? '✓' : '!'}</span>
          <p>{toast?.text || error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setToast(null);
            }}
          >
            ×
          </button>
        </div>
      )}

      <ExportDialog
        open={exportOpen}
        script={script}
        sceneMedia={sceneMedia}
        hasFinal={Boolean(result?.videoPath)}
        projectName={projectName.trim() || result?.title || 'Untitled project'}
        busy={busy}
        onClose={() => setExportOpen(false)}
        onConfirm={(payload) => void confirmExport(payload)}
      />

      {script && (
        <GenerateScenesDialog
          open={generateOpen}
          script={script}
          sceneMedia={sceneMedia}
          hasNarration={hasNarration || Boolean(result?.audioPath)}
          busy={busy}
          progress={progress}
          onClose={() => setGenerateOpen(false)}
          onConfirm={(payload) => void confirmGenerate(payload)}
        />
      )}
    </div>
  );
}
