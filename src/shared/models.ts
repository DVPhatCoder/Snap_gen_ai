import type { ImageFamily, MediaKind, ModelOption, VideoFamily } from './types';

export const VIDEO_FAMILIES: { id: VideoFamily; label: string }[] = [
  { id: 'veo', label: 'Veo / Omni' },
  { id: 'sora', label: 'Sora' },
  { id: 'grok', label: 'Grok' },
  { id: 'seedance', label: 'Seedance' },
  { id: 'kling', label: 'Kling' },
  { id: 'meta', label: 'Meta AI' },
];

export const IMAGE_FAMILIES: { id: ImageFamily; label: string }[] = [
  { id: 'gpt-image', label: 'GPT Image' },
  { id: 'grok-image', label: 'Grok Image' },
  { id: 'snapgen-image', label: 'Snapgen Image' },
];

export const VIDEO_MODELS: ModelOption[] = [
  {
    id: 'veo-3.1',
    label: 'Veo 3.1',
    family: 'veo',
    kind: 'video',
    durations: [4, 6, 8],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16'],
    defaultDuration: 8,
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
  },
  {
    id: 'veo-3.1-fast',
    label: 'Veo 3.1 Fast',
    family: 'veo',
    kind: 'video',
    durations: [4, 6, 8],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16'],
    defaultDuration: 8,
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
  },
  {
    id: 'veo-3.1-lite',
    label: 'Veo 3.1 Lite',
    family: 'veo',
    kind: 'video',
    durations: [4, 6, 8],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16'],
    defaultDuration: 8,
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
  },
  {
    id: 'veo-2',
    label: 'Veo 2',
    family: 'veo',
    kind: 'video',
    durations: [4, 6, 8],
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16'],
    defaultDuration: 8,
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
  },
  {
    id: 'omni-flash',
    label: 'Omni Flash',
    family: 'veo',
    kind: 'video',
    durations: [10],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16'],
    defaultDuration: 10,
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
  },
  {
    id: 'sora-2',
    label: 'Sora 2',
    family: 'sora',
    kind: 'video',
    durations: [10, 15],
    resolutions: ['small'],
    aspectRatios: ['landscape', 'portrait'],
    defaultDuration: 10,
    defaultResolution: 'small',
    defaultAspectRatio: 'landscape',
  },
  {
    id: 'sora-2-pro',
    label: 'Sora 2 Pro',
    family: 'sora',
    kind: 'video',
    durations: [25],
    resolutions: ['small'],
    aspectRatios: ['landscape', 'portrait'],
    defaultDuration: 25,
    defaultResolution: 'small',
    defaultAspectRatio: 'landscape',
  },
  {
    id: 'sora-2-pro-hd',
    label: 'Sora 2 Pro HD',
    family: 'sora',
    kind: 'video',
    durations: [15],
    resolutions: ['large'],
    aspectRatios: ['landscape', 'portrait'],
    defaultDuration: 15,
    defaultResolution: 'large',
    defaultAspectRatio: 'landscape',
  },
  {
    id: 'grok-3',
    label: 'Grok 3',
    family: 'grok',
    kind: 'video',
    durations: [6, 10, 15],
    resolutions: ['480p', '720p'],
    aspectRatios: ['landscape', 'portrait', 'square'],
    defaultDuration: 10,
    defaultResolution: '720p',
    defaultAspectRatio: 'landscape',
    extraFields: {
      mode: ['custom', 'normal', 'extremely-crazy', 'extremely-spicy-or-crazy'],
    },
  },
  {
    id: 'seedance-2',
    label: 'Seedance 2',
    family: 'seedance',
    kind: 'video',
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16', '1:1', '3:4', '4:3', '21:9'],
    defaultDuration: 8,
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
    extraFields: { mode: ['fast', 'pro'] },
  },
  {
    id: 'seedance-2-omni',
    label: 'Seedance 2 Omni',
    family: 'seedance',
    kind: 'video',
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16', '1:1', '3:4', '4:3', '21:9'],
    defaultDuration: 10,
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
    extraFields: { mode: ['fast', 'pro', 'fast-2', 'pro-2', 'fast-vip', 'pro-vip'] },
  },
  {
    id: 'kling-video-3-0',
    label: 'Kling Video 3.0',
    family: 'kling',
    kind: 'video',
    durations: [5, 8, 10, 15],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultDuration: 8,
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
    extraFields: { mode: ['standard', 'professional'] },
  },
  {
    id: 'kling-video-2-6',
    label: 'Kling Video 2.6',
    family: 'kling',
    kind: 'video',
    durations: [5, 10],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultDuration: 5,
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
    extraFields: { mode: ['standard', 'professional', 'professional_audio'] },
  },
  {
    id: 'kling-video-2-5',
    label: 'Kling Video 2.5',
    family: 'kling',
    kind: 'video',
    durations: [5, 10],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultDuration: 5,
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
    extraFields: { mode: ['relax', 'standard', 'professional'] },
  },
  {
    id: 'kling-video-o1',
    label: 'Kling Video O1',
    family: 'kling',
    kind: 'video',
    durations: [5, 10],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultDuration: 5,
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
    extraFields: { mode: ['standard', 'professional'] },
  },
  {
    id: 'meta-ai-video',
    label: 'Meta AI Video',
    family: 'meta',
    kind: 'video',
    durations: [5, 10],
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultDuration: 5,
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
  },
];

export const IMAGE_MODELS: ModelOption[] = [
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    family: 'gpt-image',
    kind: 'image',
    durations: [4, 5, 6, 8, 10],
    resolutions: ['1k', '2k', '4k'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
    defaultDuration: 5,
    defaultResolution: '2k',
    defaultAspectRatio: '16:9',
    extraFields: { mode: ['low', 'medium', 'high'] },
  },
  {
    id: 'grok-image',
    label: 'Grok Image',
    family: 'grok-image',
    kind: 'image',
    durations: [4, 5, 6, 8, 10],
    resolutions: ['default'],
    aspectRatios: ['landscape', 'portrait', 'square'],
    defaultDuration: 5,
    defaultResolution: 'default',
    defaultAspectRatio: 'landscape',
    extraFields: { mode: ['normal', 'fun', 'custom'] },
  },
  {
    id: 'imagen-4',
    label: 'Imagen 4',
    family: 'snapgen-image',
    kind: 'image',
    durations: [4, 5, 6, 8, 10],
    resolutions: ['1K', '2K'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    defaultDuration: 5,
    defaultResolution: '1K',
    defaultAspectRatio: '16:9',
  },
  {
    id: 'flux-kontext-pro',
    label: 'Flux Kontext Pro',
    family: 'snapgen-image',
    kind: 'image',
    durations: [4, 5, 6, 8, 10],
    resolutions: ['1K', '2K'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    defaultDuration: 5,
    defaultResolution: '1K',
    defaultAspectRatio: '16:9',
  },
];

export const ALL_MODELS: ModelOption[] = [...VIDEO_MODELS, ...IMAGE_MODELS];

export function getFamilies(kind: MediaKind): { id: string; label: string }[] {
  return kind === 'image' ? IMAGE_FAMILIES : VIDEO_FAMILIES;
}

export function getModelsByFamily(family: string, kind?: MediaKind): ModelOption[] {
  const pool = kind ? ALL_MODELS.filter((m) => m.kind === kind) : ALL_MODELS;
  return pool.filter((m) => m.family === family);
}

export function getModelById(id: string): ModelOption | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}

export function clampDuration(modelId: string, hint: number): number {
  const model = getModelById(modelId);
  if (!model) return hint;
  return model.durations.reduce((best, d) =>
    Math.abs(d - hint) < Math.abs(best - hint) ? d : best
  );
}

/** Max seconds one API generate/extend call can produce for this model. */
export function maxSingleShotDuration(modelId: string): number {
  const model = getModelById(modelId);
  if (!model?.durations.length) return 8;
  return Math.max(...model.durations);
}

export function familySupportsExtend(family: string): boolean {
  return family === 'veo' || family === 'grok' || family === 'seedance' || family === 'kling';
}

/**
 * Plan how to cover a long scene:
 * - short scene → one generate
 * - long + supports extend → first generate, then extend chunks (same scene continuity)
 * - long + no extend → multiple independent generates (hard cuts inside scene)
 *
 * Scenes are NEVER chain-extended into each other.
 */
export function planSceneChunks(
  modelId: string,
  family: string,
  desiredSeconds: number
): { mode: 'single' | 'extend' | 'multi-cut'; chunks: number[] } {
  const max = maxSingleShotDuration(modelId);
  const desired = Math.max(1, desiredSeconds);

  if (desired <= max + 0.25) {
    return { mode: 'single', chunks: [clampDuration(modelId, desired)] };
  }

  const chunks: number[] = [];
  let left = desired;
  while (left > 0.4) {
    const take = Math.min(left, max);
    chunks.push(clampDuration(modelId, take));
    left -= take;
  }

  if (familySupportsExtend(family)) {
    return { mode: 'extend', chunks };
  }
  return { mode: 'multi-cut', chunks };
}

export function withStylePrompt(visualPrompt: string, stylePrompt?: string): string {
  const style = stylePrompt?.trim();
  if (!style) return visualPrompt;
  if (visualPrompt.toLowerCase().includes(style.toLowerCase())) return visualPrompt;
  return `${visualPrompt.trim()}. Style: ${style}`;
}

/** Fallback when a model has no declared durations (not a hard scene length). */
export const DEFAULT_DURATION_PER_SCENE = 8;

/** Typical narrative beat used only to estimate scene count ranges. */
export const TYPICAL_NARRATIVE_BEAT_SEC = 10;
const MIN_NARRATIVE_BEAT_SEC = 5;
const MAX_NARRATIVE_BEAT_SEC = 24;
/** Absolute ceiling for one scene (extend/multi-cut covers model shot limits). */
export const MAX_SCENE_DURATION_SEC = 180;
const WORDS_PER_SECOND = 2.5;

export interface SceneDurationPlan {
  targetDurationSec: number;
  /** Suggested scene count for UI / draft persistence. */
  sceneCountHint: number;
  sceneCountMin: number;
  sceneCountMax: number;
  typicalBeatSec: number;
}

/**
 * Estimate how many narrative scenes fit a target length.
 * Does NOT lock every scene to a fixed 8s — beats vary with content.
 */
export function planScenesFromDuration(
  targetDurationSec: number,
  _legacyDurationPerScene?: number
): SceneDurationPlan & { sceneCount: number; durationPerScene: number } {
  const target = Math.max(MIN_NARRATIVE_BEAT_SEC, Math.round(targetDurationSec));
  const sceneCountHint = Math.max(1, Math.round(target / TYPICAL_NARRATIVE_BEAT_SEC));
  const sceneCountMin = Math.max(1, Math.round(target / MAX_NARRATIVE_BEAT_SEC));
  const sceneCountMax = Math.max(
    sceneCountHint,
    Math.round(target / MIN_NARRATIVE_BEAT_SEC)
  );
  return {
    targetDurationSec: target,
    sceneCountHint,
    sceneCountMin,
    sceneCountMax,
    typicalBeatSec: TYPICAL_NARRATIVE_BEAT_SEC,
    // Back-compat aliases used by older UI/draft code.
    sceneCount: sceneCountHint,
    durationPerScene: TYPICAL_NARRATIVE_BEAT_SEC,
  };
}

export function countSpokenWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Natural speech pacing ≈ 2.5 words/sec. */
export function estimateSpokenSeconds(text: string, fallback = 6): number {
  const words = countSpokenWords(text);
  if (!words) return fallback;
  return Math.max(2, words / WORDS_PER_SECOND);
}

export interface SceneDurationInput {
  narration_segment?: string;
  duration_hint?: number;
}

/**
 * Blend AI duration hints with narration length, then scale so the sum
 * matches the user target. Individual scenes may exceed the model shot
 * limit — `planSceneChunks` handles extend / multi-cut at generate time.
 */
export function normalizeSceneDurations<T extends SceneDurationInput>(
  scenes: T[],
  targetDurationSec: number
): Array<T & { duration_hint: number }> {
  if (!scenes.length) return [];

  const target = Math.max(scenes.length * 2, Math.round(targetDurationSec));
  const weights = scenes.map((scene) => {
    const fromWords = estimateSpokenSeconds(scene.narration_segment || '', 0);
    const fromHint = Number(scene.duration_hint);
    const hint = Number.isFinite(fromHint) && fromHint > 0 ? fromHint : 0;
    if (fromWords > 0 && hint > 0) return Math.max(2, fromWords * 0.65 + hint * 0.35);
    if (fromWords > 0) return Math.max(2, fromWords);
    if (hint > 0) return Math.max(2, hint);
    return TYPICAL_NARRATIVE_BEAT_SEC;
  });

  const weightSum = weights.reduce((sum, value) => sum + value, 0) || scenes.length;
  const assigned = scenes.map((scene, index) => {
    const raw = (weights[index] / weightSum) * target;
    const duration = Math.min(
      MAX_SCENE_DURATION_SEC,
      Math.max(2, Math.round(raw * 10) / 10)
    );
    return { ...scene, duration_hint: duration };
  });

  const sum = assigned.reduce((total, scene) => total + scene.duration_hint, 0);
  const drift = Math.round((target - sum) * 10) / 10;
  const last = assigned[assigned.length - 1];
  last.duration_hint = Math.min(
    MAX_SCENE_DURATION_SEC,
    Math.max(2, Math.round((last.duration_hint + drift) * 10) / 10)
  );

  return assigned;
}

export function formatDurationLabel(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  if (sec < 60) return `${sec}s`;
  const minutes = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${minutes} phút ${rem}s` : `${minutes} phút`;
}
