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
  /** Default model viết kịch bản cho dự án mới (mỗi dự án có thể đổi riêng). */
  openaiModel: string;
  /** Default TTS cho dự án mới (fallback khi draft cũ thiếu). */
  openaiTtsModel: string;
  openaiTtsVoice: string;
  ttsProvider: 'openai' | 'elevenlabs';
  elevenLabsVoiceId: string;
  elevenLabsModelId: string;
  burnSubtitles: boolean;
  lastExportDir?: string;
}

/** Voiceover gắn theo từng dự án (lưu trong draft.json). */
export interface ProjectVoiceSettings {
  ttsProvider: 'openai' | 'elevenlabs';
  openaiTtsModel: string;
  openaiTtsVoice: string;
  elevenLabsVoiceId: string;
  elevenLabsModelId: string;
}

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  previewUrl?: string;
  category?: string;
  labels?: Record<string, string>;
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

export type SceneSection = 'introduction' | 'body' | 'conclusion';

export interface SceneDraft {
  id: string;
  visual_prompt: string;
  narration_segment: string;
  duration_hint: number;
  /** Phần cấu trúc kịch bản cố định: mở đầu / thân / kết. */
  section?: SceneSection;
  /**
   * Chapter nội dung (Opening, Top 10, …). Một chapter gồm nhiều scene beat.
   * Không phải một scene duy nhất.
   */
  chapter?: string;
}

export interface ScriptDraft {
  title: string;
  narration: string;
  scenes: SceneDraft[];
}

export interface GenerateIdeaInput {
  brief: string;
  language: string;
  /** Desired total video length in seconds. Scene count & per-scene lengths are derived. */
  targetDurationSec: number;
  /** Optional override; otherwise estimated from target duration. */
  sceneCount?: number;
  family: VideoFamily | ImageFamily;
  model: string;
  aspectRatio: string;
  resolution: string;
  /** Max seconds one generate/extend API call can produce (for prompt guidance). */
  maxShotSec?: number;
  /** @deprecated Prefer variable durations from content; kept for older callers. */
  durationPerScene?: number;
  mediaKind: MediaKind;
  stylePrompt?: string;
  /** Model ChatGPT viết kịch bản theo dự án. */
  openaiChatModel?: string;
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
  /** Desired total video length in seconds (drives auto scene split). */
  targetDurationSec?: number;
  hasVideo?: boolean;
  lastError?: string;
  mediaKind?: MediaKind;
  stylePrompt?: string;
}

export interface ProjectDraft {
  brief: string;
  language: string;
  sceneCount: number;
  /** Desired total video length in seconds (drives auto scene split). */
  targetDurationSec: number;
  family: VideoFamily | ImageFamily;
  model: string;
  aspectRatio: string;
  resolution: string;
  mode?: string;
  script: ScriptDraft | null;
  mediaKind: MediaKind;
  stylePrompt: string;
  /** Model ChatGPT viết kịch bản — theo từng dự án. */
  openaiChatModel: string;
  /** Voiceover theo dự án. */
  ttsProvider: 'openai' | 'elevenlabs';
  openaiTtsModel: string;
  openaiTtsVoice: string;
  elevenLabsVoiceId: string;
  elevenLabsModelId: string;
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
  targetDurationSec?: number;
  family?: VideoFamily | ImageFamily;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  mode?: string;
  mediaKind?: MediaKind;
  stylePrompt?: string;
  openaiChatModel?: string;
  ttsProvider?: 'openai' | 'elevenlabs';
  openaiTtsModel?: string;
  openaiTtsVoice?: string;
  elevenLabsVoiceId?: string;
  elevenLabsModelId?: string;
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
  /** Voiceover theo dự án (ưu tiên hơn AppSettings). */
  ttsProvider?: 'openai' | 'elevenlabs';
  openaiTtsModel?: string;
  openaiTtsVoice?: string;
  elevenLabsVoiceId?: string;
  elevenLabsModelId?: string;
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
  /** Overall job progress 0–100 (progress bar). */
  percent?: number;
  /** Snapgen render progress for the current shot 0–100. */
  detailPercent?: number;
  chunkIndex?: number;
  chunkTotal?: number;
  error?: string;
}

export type ActiveJobKind = 'generate' | 'remux';

/** Snapshot job đang chạy trên main — dùng khi quay lại UI sau khi thoát Studio. */
export interface ActiveJobSnapshot {
  active: boolean;
  projectId: string | null;
  projectName: string | null;
  kind: ActiveJobKind | null;
  progress: JobProgress | null;
  startedAt: number | null;
}

export interface JobFinishedEvent {
  projectId: string | null;
  kind: ActiveJobKind | null;
  ok: boolean;
  error?: string;
  result?: GenerateJobResult;
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

export type ProviderQuotaId = 'snapgen' | 'elevenlabs';

export interface ProviderQuota {
  id: ProviderQuotaId;
  label: string;
  ok: boolean;
  message: string;
  remaining?: number;
  used?: number;
  limit?: number;
  unit?: 'credit' | 'character' | 'USD' | 'token';
  plan?: string;
  resetAt?: string;
  detail?: string;
}

export interface UsageSnapshot {
  updatedAt: string;
  providers: ProviderQuota[];
}

export interface UsageHistoryItem {
  id: string;
  provider: ProviderQuotaId;
  title: string;
  detail?: string;
  amount: number;
  unit: 'credit' | 'character';
  status?: string;
  createdAt: string;
}

export interface ProviderUsageHistory {
  provider: ProviderQuotaId;
  label: string;
  ok: boolean;
  message: string;
  totalAmount: number;
  unit: 'credit' | 'character';
  items: UsageHistoryItem[];
  /** Còn trang/cursor để tải thêm. */
  hasMore?: boolean;
  /** Snapgen page tiếp theo (1-based đã fetch xong → next = page + 1). */
  nextPage?: number;
  /** ElevenLabs start_after_history_item_id. */
  nextCursor?: string;
  /** Tổng record Snapgen (nếu API trả). */
  totalCount?: number;
}

export interface UsageHistorySnapshot {
  updatedAt: string;
  providers: ProviderUsageHistory[];
}

export interface LoadMoreUsageHistoryRequest {
  provider: ProviderQuotaId;
  page?: number;
  cursor?: string;
}

export interface LoadMoreUsageHistoryResult {
  provider: ProviderQuotaId;
  ok: boolean;
  message: string;
  items: UsageHistoryItem[];
  hasMore: boolean;
  nextPage?: number;
  nextCursor?: string;
  totalCount?: number;
}

export interface ElevenLabsSessionStatus {
  loggedIn: boolean;
  email?: string;
  displayName?: string;
  updatedAt?: string;
  cookieCount: number;
  /** True when xi-api-key was auto-captured from the in-app browser session. */
  hasApiCredential?: boolean;
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

/** Model ChatGPT dùng để viết kịch bản (không phải model Snapgen video/ảnh). */
export const OPENAI_CHAT_MODELS = [
  { id: 'gpt-4o-mini', label: 'GPT-4o mini (nhanh, rẻ)' },
  { id: 'gpt-4o', label: 'GPT-4o (khuyên dùng video dài)' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'o4-mini', label: 'o4-mini' },
] as const;

export const ELEVENLABS_TTS_MODELS = [
  'eleven_flash_v2_5',
  'eleven_turbo_v2_5',
  'eleven_v3',
  'eleven_multilingual_v2',
] as const;
