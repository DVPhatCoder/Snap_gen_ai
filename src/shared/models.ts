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
  { id: 'snapgen-image', label: 'Snapgen Image' },
  { id: 'gpt-image', label: 'GPT Image' },
  { id: 'grok-image', label: 'Grok Image' },
];

export const DEFAULT_VIDEO_FAMILY: VideoFamily = 'veo';
export const DEFAULT_VIDEO_MODEL_ID = 'veo-3.1-fast';
export const DEFAULT_IMAGE_FAMILY: ImageFamily = 'snapgen-image';
export const DEFAULT_IMAGE_MODEL_ID = 'nano-banana-2';

export function defaultFamilyForKind(kind: MediaKind): VideoFamily | ImageFamily {
  return kind === 'image' ? DEFAULT_IMAGE_FAMILY : DEFAULT_VIDEO_FAMILY;
}

export function defaultModelIdForKind(kind: MediaKind): string {
  return kind === 'image' ? DEFAULT_IMAGE_MODEL_ID : DEFAULT_VIDEO_MODEL_ID;
}

export const VIDEO_MODELS: ModelOption[] = [
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
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
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
    id: 'nano-banana-2-lite',
    label: 'Nano Banana 2 Lite',
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
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
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
];

export const ALL_MODELS: ModelOption[] = [...VIDEO_MODELS, ...IMAGE_MODELS];

/** Old Snapgen image model ids → current allowed ids. */
const LEGACY_MODEL_ALIASES: Record<string, string> = {
  'imagen-4': 'nano-banana-2',
  'imagen-3': 'nano-banana-2',
  'flux-kontext-pro': 'nano-banana-pro',
  'flux-kontext': 'nano-banana-pro',
};

export function resolveModelId(modelId: string): string {
  return LEGACY_MODEL_ALIASES[modelId] || modelId;
}

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

/**
 * Soft beat guidance — AI chia scene theo ý, không hardcode 8s/15s cố định.
 * Dùng để gợi ý UI + post-process split/merge.
 */
export const MIN_SCENE_BEAT_SEC = 3;
export const MAX_SCENE_BEAT_SEC = 12;
export const IDEAL_SCENE_BEAT_SEC = 6;
/** @deprecated alias — prefer IDEAL_SCENE_BEAT_SEC */
export const TYPICAL_NARRATIVE_BEAT_SEC = IDEAL_SCENE_BEAT_SEC;
/** Absolute ceiling for one scene (extend/multi-cut covers model shot limits). */
export const MAX_SCENE_DURATION_SEC = 180;
export const WORDS_PER_SECOND = 2.5;
/** Narration phải đạt tối thiểu tỉ lệ này so với target trước TTS. */
export const MIN_NARRATION_COVERAGE = 0.85;
/** Sau TTS: nếu |audio − target| / target > ngưỡng này → AI rewrite + TTS lại. */
export const AUDIO_DURATION_TOLERANCE = 0.03;
/** Số lần TTS tối đa trong vòng fit duration. */
export const MAX_TTS_FIT_ATTEMPTS = 4;

export interface SceneDurationPlan {
  targetDurationSec: number;
  /** Ước lượng mềm cho UI / chi phí — không ép AI đúng số này. */
  sceneCountHint: number;
  sceneCountMin: number;
  sceneCountMax: number;
  typicalBeatSec: number;
  /** Soft average nếu chia đều — chỉ để hiển thị. */
  secondsPerScene: number;
  /** Total words needed ≈ target * WORDS_PER_SECOND. */
  targetWordCount: number;
}

/**
 * Ước lượng mềm số scene từ thời lượng (UI / cost hint).
 * AI chia theo beat nội dung; không hardcode N scene × T giây.
 */
export function planScenesFromDuration(
  targetDurationSec: number,
  _legacyDurationPerScene?: number
): SceneDurationPlan & { sceneCount: number; durationPerScene: number } {
  const target = Math.max(MIN_SCENE_BEAT_SEC * 3, Math.round(targetDurationSec));
  const typicalBeatSec = IDEAL_SCENE_BEAT_SEC;
  const sceneCountHint = Math.max(3, Math.round(target / typicalBeatSec));
  const sceneCountMin = Math.max(3, Math.round(target / MAX_SCENE_BEAT_SEC));
  const sceneCountMax = Math.max(sceneCountHint, Math.round(target / MIN_SCENE_BEAT_SEC));
  const secondsPerScene = Math.round((target / sceneCountHint) * 10) / 10;
  return {
    targetDurationSec: target,
    sceneCountHint,
    sceneCountMin,
    sceneCountMax,
    typicalBeatSec,
    secondsPerScene,
    targetWordCount: Math.round(target * WORDS_PER_SECOND),
    sceneCount: sceneCountHint,
    durationPerScene: secondsPerScene,
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

export function wordsForDurationSec(seconds: number): number {
  return Math.max(4, Math.round(Math.max(0, seconds) * WORDS_PER_SECOND));
}

export function estimateScriptSpokenSeconds(
  scenes: Array<{ narration_segment?: string }>
): number {
  return scenes.reduce(
    (sum, scene) => sum + estimateSpokenSeconds(scene.narration_segment || '', 0),
    0
  );
}

export function narrationCoverageRatio(
  scenes: Array<{ narration_segment?: string }>,
  targetDurationSec: number
): number {
  const target = Math.max(1, targetDurationSec);
  return estimateScriptSpokenSeconds(scenes) / target;
}

/** Chặn TTS/render nếu narration còn thiếu so với mục tiêu. */
export function assertNarrationCoversTarget(
  scenes: Array<{ narration_segment?: string }>,
  targetDurationSec: number,
  minRatio = MIN_NARRATION_COVERAGE
): void {
  const spoken = estimateScriptSpokenSeconds(scenes);
  const target = Math.max(1, Math.round(targetDurationSec));
  if (spoken < target * minRatio) {
    const needWords = Math.round(target * WORDS_PER_SECOND);
    const haveWords = Math.round(spoken * WORDS_PER_SECOND);
    throw new Error(
      `Narration quá ngắn: ~${formatDurationLabel(spoken)} (~${haveWords} từ) so với mục tiêu ${formatDurationLabel(target)} (~${needWords} từ). ` +
        `AI chưa viết đủ lời thoại — hãy Generate script lại (hoặc rút ngắn thời lượng video).`
    );
  }
}

/**
 * Mỗi scene: lời đọc phải đủ để lấp đầy duration_hint (pace ≈ 2.5 từ/s).
 * Trả về danh sách scene còn thiếu.
 */
export function findScenesWithShortNarration<
  T extends { id?: string; narration_segment?: string; duration_hint?: number },
>(scenes: T[], minRatio = MIN_NARRATION_COVERAGE): Array<{ index: number; scene: T; spoken: number; planned: number }> {
  const out: Array<{ index: number; scene: T; spoken: number; planned: number }> = [];
  scenes.forEach((scene, index) => {
    const planned = Math.max(2, Number(scene.duration_hint) || IDEAL_SCENE_BEAT_SEC);
    const spoken = estimateSpokenSeconds(scene.narration_segment || '', 0);
    if (spoken < planned * minRatio) {
      out.push({ index, scene, spoken, planned });
    }
  });
  return out;
}

export function assertScenesNarrationFillDuration(
  scenes: Array<{ id?: string; narration_segment?: string; duration_hint?: number }>,
  minRatio = MIN_NARRATION_COVERAGE
): void {
  const short = findScenesWithShortNarration(scenes, minRatio);
  if (!short.length) return;
  const sample = short
    .slice(0, 5)
    .map(
      (s) =>
        `scene ${s.index + 1}: ~${Math.round(s.spoken)}s lời / ${s.planned}s cần`
    )
    .join('; ');
  throw new Error(
    `${short.length} scene có narration quá ngắn so với thời lượng scene (${sample}` +
      `${short.length > 5 ? '…' : ''}). Narration must naturally fill each scene duration — Generate script lại.`
  );
}

export interface SceneDurationInput {
  narration_segment?: string;
  duration_hint?: number;
}

/**
 * Gán duration_hint theo độ dài narration (beat nội dung), rồi scale tổng = target.
 * Không ép mọi scene cùng một số giây cố định.
 */
export function normalizeSceneDurations<T extends SceneDurationInput>(
  scenes: T[],
  targetDurationSec: number
): Array<T & { duration_hint: number }> {
  if (!scenes.length) return [];

  const target = Math.max(scenes.length * MIN_SCENE_BEAT_SEC, Math.round(targetDurationSec));
  const weights = scenes.map((scene) => {
    const fromWords = estimateSpokenSeconds(scene.narration_segment || '', 0);
    const fromHint = Number(scene.duration_hint);
    const hint = Number.isFinite(fromHint) && fromHint > 0 ? fromHint : 0;
    // Ưu tiên độ dài lời nói (nội dung); hint AI chỉ phụ.
    if (fromWords > 0 && hint > 0) return Math.max(MIN_SCENE_BEAT_SEC, fromWords * 0.75 + hint * 0.25);
    if (fromWords > 0) return Math.max(MIN_SCENE_BEAT_SEC, fromWords);
    if (hint > 0) return Math.max(MIN_SCENE_BEAT_SEC, hint);
    return IDEAL_SCENE_BEAT_SEC;
  });

  const weightSum = weights.reduce((sum, value) => sum + value, 0) || scenes.length;
  const assigned = scenes.map((scene, index) => {
    const raw = (weights[index] / weightSum) * target;
    const duration = Math.min(
      MAX_SCENE_DURATION_SEC,
      Math.max(MIN_SCENE_BEAT_SEC, Math.round(raw * 10) / 10)
    );
    return { ...scene, duration_hint: duration };
  });

  const sum = assigned.reduce((total, scene) => total + scene.duration_hint, 0);
  const drift = Math.round((target - sum) * 10) / 10;
  const last = assigned[assigned.length - 1];
  last.duration_hint = Math.min(
    MAX_SCENE_DURATION_SEC,
    Math.max(MIN_SCENE_BEAT_SEC, Math.round((last.duration_hint + drift) * 10) / 10)
  );

  return assigned;
}

/**
 * Gộp scene narration quá ngắn (< MIN) vào scene trước nếu cùng chapter/section.
 */
export function mergeUndersizedScenes<
  T extends {
    id?: string;
    section?: string;
    chapter?: string;
    narration_segment?: string;
    visual_prompt?: string;
    duration_hint?: number;
  },
>(scenes: T[]): T[] {
  if (scenes.length < 2) return scenes;
  const out: T[] = [];
  for (const scene of scenes) {
    const spoken = estimateSpokenSeconds(scene.narration_segment || '', 0);
    const prev = out[out.length - 1];
    const sameBucket =
      prev &&
      (prev.section || '') === (scene.section || '') &&
      (prev.chapter || '').trim().toLowerCase() === (scene.chapter || '').trim().toLowerCase();
    if (prev && sameBucket && spoken > 0 && spoken < MIN_SCENE_BEAT_SEC) {
      prev.narration_segment = `${(prev.narration_segment || '').trim()} ${(scene.narration_segment || '').trim()}`.trim();
      continue;
    }
    out.push({ ...scene });
  }
  // Scene cuối quá ngắn → gộp vào trước nếu cùng bucket.
  if (out.length >= 2) {
    const last = out[out.length - 1];
    const prev = out[out.length - 2];
    const spoken = estimateSpokenSeconds(last.narration_segment || '', 0);
    const sameBucket =
      (prev.section || '') === (last.section || '') &&
      (prev.chapter || '').trim().toLowerCase() === (last.chapter || '').trim().toLowerCase();
    if (sameBucket && spoken > 0 && spoken < MIN_SCENE_BEAT_SEC) {
      prev.narration_segment = `${(prev.narration_segment || '').trim()} ${(last.narration_segment || '').trim()}`.trim();
      out.pop();
    }
  }
  return out;
}

export function formatDurationLabel(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  if (sec < 60) return `${sec}s`;
  const minutes = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${minutes} phút ${rem}s` : `${minutes} phút`;
}
