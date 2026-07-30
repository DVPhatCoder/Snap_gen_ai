export type MediaKind = 'video' | 'image';
export type VideoFamily = 'veo' | 'sora' | 'grok' | 'seedance' | 'kling' | 'meta';
export type ImageFamily = 'gpt-image' | 'grok-image' | 'snapgen-image';

export interface ModelOption {
  id: string;
  label: string;
  family: VideoFamily | ImageFamily;
  kind: MediaKind;
  durations: number[];
  resolutions: string[];
  aspectRatios: string[];
  defaultDuration: number;
  defaultResolution: string;
  defaultAspectRatio: string;
  extraFields?: Record<string, string[]>;
}

export interface ApiKeys {
  snapgenApiKey: string;
  openaiApiKey: string;
}

export interface AppSettings {
  openaiModel: string;
  openaiTtsModel: string;
  openaiTtsVoice: string;
  burnSubtitles: boolean;
  lastExportDir?: string;
}

export type ExportMode = 'final' | 'scenes';

export interface ExportSceneItem {
  sourcePath: string;
  fileName: string;
}

export interface ExportMediaRequest {
  mode: ExportMode;
  /** Single final file — shows Save As dialog. */
  final?: {
    sourcePath: string;
    suggestedName?: string;
  };
  /** Multiple scene clips/images — shows folder picker. */
  scenes?: ExportSceneItem[];
}

export interface ExportMediaResult {
  mode: ExportMode;
  /** Final file path, or destination folder for scenes. */
  path: string;
  /** Copied scene file paths when mode === 'scenes'. */
  files?: string[];
}

export interface SceneDraft {
  id: string;
  visual_prompt: string;
  narration_segment: string;
  duration_hint: number;
}

export interface ScriptDraft {
  title: string;
  narration: string;
  scenes: SceneDraft[];
}

export interface GenerateIdeaInput {
  brief: string;
  language: string;
  sceneCount: number;
  family: VideoFamily | ImageFamily;
  model: string;
  aspectRatio: string;
  resolution: string;
  durationPerScene?: number;
  mediaKind: MediaKind;
  stylePrompt?: string;
}

export type ProjectStatus = 'draft' | 'generating' | 'ready' | 'error';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  brief?: string;
  language?: string;
  family?: VideoFamily | ImageFamily;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  mode?: string;
  sceneCount?: number;
  hasVideo?: boolean;
  lastError?: string;
  mediaKind?: MediaKind;
  stylePrompt?: string;
}

export interface ProjectDraft {
  brief: string;
  language: string;
  sceneCount: number;
  family: VideoFamily | ImageFamily;
  model: string;
  aspectRatio: string;
  resolution: string;
  mode?: string;
  script: ScriptDraft | null;
  mediaKind: MediaKind;
  stylePrompt: string;
}

export interface SceneMediaAsset {
  sceneId: string;
  sceneIndex: number;
  path: string;
  kind: MediaKind;
  exists: boolean;
}

export interface ProjectDetail {
  meta: ProjectMeta;
  draft: ProjectDraft | null;
  videoPath: string | null;
  srtPath: string | null;
  audioPath: string | null;
  sceneMedia: SceneMediaAsset[];
  projectDir: string;
}

export interface CreateProjectInput {
  name: string;
  brief?: string;
  language?: string;
  sceneCount?: number;
  family?: VideoFamily | ImageFamily;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  mode?: string;
  mediaKind?: MediaKind;
  stylePrompt?: string;
}

export interface GenerateJobInput {
  projectId: string;
  projectName?: string;
  script: ScriptDraft;
  family: VideoFamily | ImageFamily;
  model: string;
  aspectRatio: string;
  resolution: string;
  mode?: string;
  burnSubtitles?: boolean;
  brief?: string;
  language?: string;
  mediaKind: MediaKind;
  stylePrompt?: string;
  forceRegenerate?: boolean;
  /** Scene ids to create or recreate. Missing scenes are always generated. */
  regenerateSceneIds?: string[];
  /** When false and narration already exists, skip TTS + Whisper. Default true. */
  refreshNarration?: boolean;
}

export type JobPhase =
  | 'idle'
  | 'tts'
  | 'whisper'
  | 'video'
  | 'image'
  | 'merge'
  | 'done'
  | 'error';

export interface JobProgress {
  phase: JobPhase;
  message: string;
  sceneIndex?: number;
  sceneTotal?: number;
  percent?: number;
  error?: string;
}

export interface GenerateJobResult {
  projectId: string;
  projectName: string;
  projectDir: string;
  videoPath: string;
  srtPath: string;
  audioPath: string;
  title: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

export const OPENAI_TTS_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
] as const;

export const OPENAI_TTS_MODELS = ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'] as const;
