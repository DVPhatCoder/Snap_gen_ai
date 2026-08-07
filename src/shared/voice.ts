import type {
  AppSettings,
  DashScopeRegion,
  ProjectVoiceSettings,
  TtsProvider,
} from './types';

export const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o-mini';

export function isTtsProvider(value: unknown): value is TtsProvider {
  return value === 'openai' || value === 'elevenlabs' || value === 'qwen';
}

export function isDashScopeRegion(value: unknown): value is DashScopeRegion {
  return value === 'intl' || value === 'cn';
}

export function isQwenInstructModel(model: string | null | undefined): boolean {
  return String(model || '').toLowerCase().includes('instruct');
}

/** Model viết kịch bản theo dự án; fallback Settings → default. */
export function resolveProjectChatModel(
  draftModel?: string | null,
  settingsDefault?: string | null
): string {
  const value = String(draftModel || settingsDefault || DEFAULT_OPENAI_CHAT_MODEL).trim();
  return value || DEFAULT_OPENAI_CHAT_MODEL;
}

export const DEFAULT_PROJECT_VOICE: ProjectVoiceSettings = {
  ttsProvider: 'openai',
  openaiTtsModel: 'gpt-4o-mini-tts',
  openaiTtsVoice: 'nova',
  elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
  elevenLabsModelId: 'eleven_flash_v2_5',
  qwenTtsModel: 'qwen3-tts-flash',
  qwenTtsVoice: 'Cherry',
  qwenTtsInstructions: '',
};

export function projectDraftHasVoice(
  partial: Partial<ProjectVoiceSettings> | null | undefined
): boolean {
  if (!partial) return false;
  return (
    isTtsProvider(partial.ttsProvider) ||
    Boolean(partial.openaiTtsVoice) ||
    Boolean(partial.elevenLabsVoiceId) ||
    Boolean(partial.qwenTtsVoice)
  );
}

/**
 * Gộp voice từ draft/input với default app (cho dự án cũ thiếu field).
 * Nếu draft đã có voice → ưu tiên tuyệt đối draft (không lấy Settings ghi đè).
 */
export function resolveProjectVoice(
  partial: Partial<ProjectVoiceSettings> | null | undefined,
  defaults?: Partial<AppSettings> | null
): ProjectVoiceSettings {
  const base: ProjectVoiceSettings = {
    ttsProvider: isTtsProvider(defaults?.ttsProvider)
      ? defaults!.ttsProvider
      : DEFAULT_PROJECT_VOICE.ttsProvider,
    openaiTtsModel: defaults?.openaiTtsModel || DEFAULT_PROJECT_VOICE.openaiTtsModel,
    openaiTtsVoice: defaults?.openaiTtsVoice || DEFAULT_PROJECT_VOICE.openaiTtsVoice,
    elevenLabsVoiceId: defaults?.elevenLabsVoiceId || DEFAULT_PROJECT_VOICE.elevenLabsVoiceId,
    elevenLabsModelId: defaults?.elevenLabsModelId || DEFAULT_PROJECT_VOICE.elevenLabsModelId,
    qwenTtsModel: defaults?.qwenTtsModel || DEFAULT_PROJECT_VOICE.qwenTtsModel,
    qwenTtsVoice: defaults?.qwenTtsVoice || DEFAULT_PROJECT_VOICE.qwenTtsVoice,
    qwenTtsInstructions:
      defaults?.qwenTtsInstructions ?? DEFAULT_PROJECT_VOICE.qwenTtsInstructions,
  };
  if (!projectDraftHasVoice(partial)) return base;
  return {
    ttsProvider: isTtsProvider(partial!.ttsProvider) ? partial!.ttsProvider : base.ttsProvider,
    openaiTtsModel: partial!.openaiTtsModel || base.openaiTtsModel,
    openaiTtsVoice: partial!.openaiTtsVoice || base.openaiTtsVoice,
    elevenLabsVoiceId: partial!.elevenLabsVoiceId || base.elevenLabsVoiceId,
    elevenLabsModelId: partial!.elevenLabsModelId || base.elevenLabsModelId,
    elevenLabsPublicOwnerId: partial!.elevenLabsPublicOwnerId?.trim() || undefined,
    elevenLabsOriginalVoiceId: partial!.elevenLabsOriginalVoiceId?.trim() || undefined,
    elevenLabsVoiceName: partial!.elevenLabsVoiceName?.trim() || undefined,
    qwenTtsModel: partial!.qwenTtsModel || base.qwenTtsModel,
    qwenTtsVoice: partial!.qwenTtsVoice || base.qwenTtsVoice,
    qwenTtsInstructions:
      partial!.qwenTtsInstructions !== undefined
        ? partial!.qwenTtsInstructions
        : base.qwenTtsInstructions,
  };
}
