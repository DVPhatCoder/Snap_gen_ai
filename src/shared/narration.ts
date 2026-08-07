/**
 * Narration transcript helpers — dùng chung renderer.
 */

export function buildContinuousNarrationTranscript(
  scenes: Array<{ narration_segment?: string | null }> | null | undefined
): string {
  if (!scenes?.length) return '';
  return scenes
    .map((scene) => (scene.narration_segment || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

/** Bản có đánh số scene — dễ đọc / cắt đoạn khi copy. */
export function buildSceneNarrationTranscript(
  scenes: Array<{ narration_segment?: string | null }> | null | undefined
): string {
  if (!scenes?.length) return '';
  return scenes
    .map((scene, index) => {
      const text = (scene.narration_segment || '').replace(/\s+/g, ' ').trim();
      if (!text) return '';
      return `[Scene ${index + 1}]\n${text}`;
    })
    .filter(Boolean)
    .join('\n\n');
}
