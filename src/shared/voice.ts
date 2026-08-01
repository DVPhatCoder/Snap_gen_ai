import type { AppSettings, ProjectVoiceSettings } from './types';

export const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o-mini';

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
};

export function projectDraftHasVoice(
  partial: Partial<ProjectVoiceSettings> | null | undefined
): boolean {
  if (!partial) return false;
  return (
    partial.ttsProvider === 'openai' ||
    partial.ttsProvider === 'elevenlabs' ||
    Boolean(partial.openaiTtsVoice) ||
    Boolean(partial.elevenLabsVoiceId)
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
    ttsProvider:
      defaults?.ttsProvider === 'elevenlabs' || defaults?.ttsProvider === 'openai'
        ? defaults.ttsProvider
        : DEFAULT_PROJECT_VOICE.ttsProvider,
    openaiTtsModel: defaults?.openaiTtsModel || DEFAULT_PROJECT_VOICE.openaiTtsModel,
    openaiTtsVoice: defaults?.openaiTtsVoice || DEFAULT_PROJECT_VOICE.openaiTtsVoice,
    elevenLabsVoiceId: defaults?.elevenLabsVoiceId || DEFAULT_PROJECT_VOICE.elevenLabsVoiceId,
    elevenLabsModelId: defaults?.elevenLabsModelId || DEFAULT_PROJECT_VOICE.elevenLabsModelId,
  };
  if (!projectDraftHasVoice(partial)) return base;
  return {
    ttsProvider:
      partial!.ttsProvider === 'elevenlabs' || partial!.ttsProvider === 'openai'
        ? partial!.ttsProvider
        : base.ttsProvider,
    openaiTtsModel: partial!.openaiTtsModel || base.openaiTtsModel,
    openaiTtsVoice: partial!.openaiTtsVoice || base.openaiTtsVoice,
    elevenLabsVoiceId: partial!.elevenLabsVoiceId || base.elevenLabsVoiceId,
    elevenLabsModelId: partial!.elevenLabsModelId || base.elevenLabsModelId,
  };
}
