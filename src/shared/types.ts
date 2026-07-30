export type VideoFamily = 'veo' | 'sora' | 'grok' | 'seedance' | 'kling' | 'meta';

export interface ModelOption {
  id: string;
  label: string;
  family: VideoFamily;
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
  elevenLabsApiKey: string;
}

export interface AppSettings {
  openaiModel: string;
  elevenLabsVoiceId: string;
  burnSubtitles: boolean;
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
  family: VideoFamily;
  model: string;
  aspectRatio: string;
  resolution: string;
  durationPerScene?: number;
}

export interface GenerateJobInput {
  projectId: string;
  script: ScriptDraft;
  family: VideoFamily;
  model: string;
  aspectRatio: string;
  resolution: string;
  mode?: string;
  burnSubtitles?: boolean;
}

export type JobPhase =
  | 'idle'
  | 'tts'
  | 'video'
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
