/**
 * Output Format (UI) ↔ aspectRatio (API / pipeline).
 * Logic nội bộ vẫn dùng aspectRatio; format chỉ là preset hiển thị.
 */

export type OutputFormatId =
  | 'youtube'
  | 'youtube-shorts'
  | 'tiktok'
  | 'instagram-reels'
  | 'instagram-post'
  | 'instagram-story';

export interface OutputFormatPreset {
  id: OutputFormatId;
  /** Nhãn hiển thị (có icon emoji). */
  label: string;
  icon: string;
  /** Aspect ratio chuẩn gửi API khi model hỗ trợ. */
  aspectRatio: '16:9' | '9:16' | '1:1';
}

export const OUTPUT_FORMAT_PRESETS: readonly OutputFormatPreset[] = [
  {
    id: 'youtube',
    label: 'YouTube (16:9)',
    icon: '📺',
    aspectRatio: '16:9',
  },
  {
    id: 'youtube-shorts',
    label: 'YouTube Shorts (9:16)',
    icon: '📱',
    aspectRatio: '9:16',
  },
  {
    id: 'tiktok',
    label: 'TikTok (9:16)',
    icon: '🎵',
    aspectRatio: '9:16',
  },
  {
    id: 'instagram-reels',
    label: 'Instagram Reels (9:16)',
    icon: '📸',
    aspectRatio: '9:16',
  },
  {
    id: 'instagram-post',
    label: 'Instagram Post (1:1)',
    icon: '📷',
    aspectRatio: '1:1',
  },
  {
    id: 'instagram-story',
    label: 'Instagram Story (9:16)',
    icon: '📖',
    aspectRatio: '9:16',
  },
] as const;

const FORMAT_BY_ID = Object.fromEntries(
  OUTPUT_FORMAT_PRESETS.map((p) => [p.id, p])
) as Record<OutputFormatId, OutputFormatPreset>;

/** Alias model Snapgen (landscape/portrait/square) → ratio chuẩn. */
const LEGACY_TO_CANONICAL: Record<string, '16:9' | '9:16' | '1:1'> = {
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
  landscape: '16:9',
  portrait: '9:16',
  square: '1:1',
  '4:3': '16:9',
  '21:9': '16:9',
  '3:4': '9:16',
  '2:3': '9:16',
  '3:2': '16:9',
};

export function getOutputFormatPreset(id: string | null | undefined): OutputFormatPreset | undefined {
  if (!id) return undefined;
  return FORMAT_BY_ID[id as OutputFormatId];
}

export function isOutputFormatId(value: string | null | undefined): value is OutputFormatId {
  return Boolean(value && value in FORMAT_BY_ID);
}

/** Chuẩn hóa aspectRatio đã lưu → 16:9 | 9:16 | 1:1. */
export function canonicalAspectRatio(
  aspectRatio: string | null | undefined
): '16:9' | '9:16' | '1:1' {
  const key = String(aspectRatio || '16:9').trim();
  return LEGACY_TO_CANONICAL[key] || '16:9';
}

/**
 * Map ratio chuẩn sang giá trị model chấp nhận (giữ API cũ).
 * VD: 16:9 → landscape nếu model chỉ có landscape/portrait.
 */
export function resolveAspectRatioForModel(
  preferred: string,
  modelAspectRatios: string[] | null | undefined
): string {
  const list = modelAspectRatios?.length ? modelAspectRatios : ['16:9', '9:16', '1:1'];
  const canonical = canonicalAspectRatio(preferred);
  if (list.includes(preferred)) return preferred;
  if (list.includes(canonical)) return canonical;

  const fallbacks: Record<'16:9' | '9:16' | '1:1', string[]> = {
    '16:9': ['16:9', 'landscape', '4:3', '21:9', '3:2'],
    '9:16': ['9:16', 'portrait', '3:4', '2:3'],
    '1:1': ['1:1', 'square'],
  };
  for (const candidate of fallbacks[canonical]) {
    if (list.includes(candidate)) return candidate;
  }
  return list[0];
}

/**
 * Suy ra Output Format từ aspectRatio đã lưu (dữ liệu cũ).
 * Nhiều format dùng 9:16 → ưu tiên youtube-shorts.
 */
export function inferOutputFormatId(
  aspectRatio: string | null | undefined,
  preferredId?: string | null
): OutputFormatId {
  if (isOutputFormatId(preferredId)) {
    const preset = FORMAT_BY_ID[preferredId];
    if (canonicalAspectRatio(aspectRatio) === preset.aspectRatio) {
      return preferredId;
    }
  }
  const canonical = canonicalAspectRatio(aspectRatio);
  if (canonical === '1:1') return 'instagram-post';
  if (canonical === '16:9') return 'youtube';
  return 'youtube-shorts';
}

export function formatOutputFormatLabel(id: string | null | undefined, aspectRatio?: string): string {
  const preset = getOutputFormatPreset(id) || getOutputFormatPreset(inferOutputFormatId(aspectRatio, id));
  if (!preset) return aspectRatio || '16:9';
  return `${preset.icon} ${preset.label}`;
}
