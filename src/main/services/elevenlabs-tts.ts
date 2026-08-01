import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElevenLabsVoice } from '../../shared/types';
import type { TranscriptWord } from './openai-audio';
import { elevenLabsFetch, getElevenLabsSessionStatus } from './elevenlabs-auth';
import {
  ElevenLabsKeyManager,
  formatElevenLabsKeysUnavailableError,
} from './api-keys/elevenlabs-key-manager';
import {
  elevenLabsFetchWithKey,
  ensureLibraryVoiceOnApiKey,
  fetchVoiceShareMeta,
  searchLibraryShareMeta,
  type VoiceShareMeta,
} from './elevenlabs-voice-share';

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel (premade — Free API OK)

export function isElevenLabsLibraryVoice(category?: string): boolean {
  return (category || '').toLowerCase() === 'library';
}

const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';

interface AlignmentPayload {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

interface TtsWithTimestampsResponse {
  audio_base64?: string;
  alignment?: AlignmentPayload;
  normalized_alignment?: AlignmentPayload;
  detail?: { status?: string; message?: string } | string;
}

function formatSrtTime(seconds: number): string {
  const msTotal = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(msTotal / 3_600_000);
  const m = Math.floor((msTotal % 3_600_000) / 60_000);
  const s = Math.floor((msTotal % 60_000) / 1000);
  const ms = msTotal % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function alignmentToWords(alignment?: AlignmentPayload): TranscriptWord[] {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  if (!chars.length) return [];

  const words: TranscriptWord[] = [];
  let buf = '';
  let wordStart = 0;
  let wordEnd = 0;

  const flush = () => {
    const text = buf.replace(/\s+/g, ' ').trim();
    if (text) words.push({ word: text, start: wordStart, end: Math.max(wordStart, wordEnd) });
    buf = '';
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? '';
    const start = starts[i] ?? wordEnd;
    const end = ends[i] ?? start;
    if (!buf) wordStart = start;
    wordEnd = end;

    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    buf += ch;
    if (/[.,!?;:。！？]/.test(ch)) flush();
  }
  flush();
  return words;
}

function wordsToSrt(words: TranscriptWord[], maxChars = 42): string {
  if (!words.length) {
    return `1\n00:00:00,000 --> 00:00:02,000\nNarration\n`;
  }

  type Cue = { start: number; end: number; text: string };
  const cues: Cue[] = [];
  let buf = '';
  let cueStart = words[0].start;
  let cueEnd = words[0].end;

  const flush = () => {
    const text = buf.replace(/\s+/g, ' ').trim();
    if (text) cues.push({ start: cueStart, end: cueEnd, text });
    buf = '';
  };

  for (const w of words) {
    if (!buf) cueStart = w.start;
    cueEnd = w.end;
    buf = buf ? `${buf} ${w.word}` : w.word;
    const trimmed = buf.trim();
    const last = w.word.trim().slice(-1);
    if (
      (['.', '!', '?', '。'].includes(last) && trimmed.length > 8) ||
      trimmed.length >= maxChars
    ) {
      flush();
    }
  }
  flush();

  return cues
    .map((cue, idx) => {
      const end = Math.max(cue.start + 0.4, cue.end);
      return `${idx + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(end)}\n${cue.text}\n`;
    })
    .join('\n');
}

async function ensureLoggedIn(): Promise<void> {
  const status = await getElevenLabsSessionStatus();
  if (!status.loggedIn && !status.hasApiCredential) {
    throw new Error('Chưa có API key ElevenLabs. Vào Settings → dán API key free rồi Lưu.');
  }
}

/** ISO 639-1 from Studio language label. */
export function resolveElevenLabsLanguageCode(language?: string): string | undefined {
  if (!language?.trim()) return undefined;
  const lang = language.toLowerCase();
  if (lang.includes('vi') || lang.includes('việt') || lang.includes('viet')) return 'vi';
  if (lang.includes('en') || lang.includes('english') || lang.includes('anh')) return 'en';
  if (lang.includes('zh') || lang.includes('trung') || lang.includes('chinese')) return 'zh';
  if (lang.includes('ja') || lang.includes('nhật') || lang.includes('japan')) return 'ja';
  if (lang.includes('ko') || lang.includes('hàn') || lang.includes('korea')) return 'ko';
  if (lang.includes('fr') || lang.includes('pháp') || lang.includes('french')) return 'fr';
  if (lang.includes('de') || lang.includes('đức') || lang.includes('german')) return 'de';
  if (lang.includes('es') || lang.includes('tây ban') || lang.includes('spanish')) return 'es';
  if (lang.includes('id') || lang.includes('indonesia')) return 'id';
  if (lang.includes('th') || lang.includes('thái') || lang.includes('thai')) return 'th';
  return undefined;
}

/**
 * Multilingual v2 does NOT support Vietnamese — that causes EN/Hindi-like accents.
 * Flash/Turbo v2.5 and v3 do support vi + language_code.
 */
const MODELS_WITH_VI = new Set([
  'eleven_flash_v2_5',
  'eleven_turbo_v2_5',
  'eleven_v3',
]);

const MODELS_WITH_LANGUAGE_CODE = new Set([
  'eleven_flash_v2_5',
  'eleven_turbo_v2_5',
  'eleven_v3',
]);

export function resolveElevenLabsModelForLanguage(
  modelId: string | undefined,
  languageCode?: string
): string {
  const model = modelId?.trim() || DEFAULT_MODEL_ID;
  if (languageCode === 'vi' && !MODELS_WITH_VI.has(model)) {
    return 'eleven_flash_v2_5';
  }
  return model;
}

export async function listElevenLabsVoices(): Promise<ElevenLabsVoice[]> {
  await ensureLoggedIn();
  const res = await elevenLabsFetch('https://api.elevenlabs.io/v1/voices');
  const data = (await res.json()) as {
    voices?: Array<{
      voice_id?: string;
      name?: string;
      preview_url?: string;
      category?: string;
      labels?: Record<string, string>;
      sharing?: {
        public_owner_id?: string;
        original_voice_id?: string;
      };
    }>;
    detail?: { message?: string } | string;
  };

  if (!res.ok) {
    const detail =
      typeof data.detail === 'string'
        ? data.detail
        : data.detail?.message || JSON.stringify(data).slice(0, 240);
    throw new Error(`Không lấy được danh sách voice ElevenLabs: HTTP ${res.status} ${detail}`);
  }

  return (data.voices ?? [])
    .filter((v) => v.voice_id && v.name)
    .map((v) => ({
      voiceId: v.voice_id!,
      name: v.name!,
      previewUrl: v.preview_url,
      category: v.category,
      labels: v.labels,
      publicOwnerId: v.sharing?.public_owner_id || undefined,
      originalVoiceId: v.sharing?.original_voice_id || undefined,
    }))
    .sort((a, b) => {
      const score = (v: ElevenLabsVoice) => {
        const cat = (v.category || '').toLowerCase();
        // Free API: premade OK; library thường bị 402.
        if (cat === 'premade') return 0;
        if (cat === 'cloned' || cat === 'generated' || cat === 'professional') return 1;
        if (cat === 'library') return 9;
        const blob = `${v.name} ${Object.values(v.labels || {}).join(' ')}`.toLowerCase();
        if (/(vietnam|vietnamese|tiếng việt|viet)/.test(blob)) return 2;
        return 3;
      };
      return score(a) - score(b) || a.name.localeCompare(b.name);
    });
}

export async function synthesizeWithElevenLabs(options: {
  text: string;
  voiceId: string;
  modelId?: string;
  language?: string;
  outDir: string;
  fileName?: string;
  /** Meta Library — để tự Add sang API key mới khi failover. */
  publicOwnerId?: string;
  originalVoiceId?: string;
  voiceName?: string;
}): Promise<{ audioPath: string; srtPath: string; words: TranscriptWord[]; modelId: string }> {
  await ensureLoggedIn();

  const trimmed = options.text.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new Error('ElevenLabs TTS: empty text');

  // Giọng “logic” user chọn (Library gốc). Mỗi API key có thể có voice_id account khác nhau.
  const selectedVoiceId = options.voiceId.trim() || DEFAULT_VOICE_ID;
  const libraryVoiceId = options.originalVoiceId?.trim() || selectedVoiceId;

  const languageCode = resolveElevenLabsLanguageCode(options.language);
  const modelId = resolveElevenLabsModelForLanguage(options.modelId, languageCode);
  fs.mkdirSync(options.outDir, { recursive: true });

  const body: Record<string, unknown> = {
    text: trimmed,
    model_id: modelId,
  };
  if (languageCode && MODELS_WITH_LANGUAGE_CODE.has(modelId)) {
    body.language_code = languageCode;
  }

  let shareMeta: VoiceShareMeta | null = options.publicOwnerId
    ? {
        publicOwnerId: options.publicOwnerId,
        libraryVoiceId,
        name: options.voiceName?.trim() || 'SnapGen Voice',
      }
    : null;

  const tried = new Set<string>();
  let lastDetail = '';

  for (;;) {
    const record = await ElevenLabsKeyManager.getAvailableKey(tried);
    if (!record) {
      throw new Error(
        formatElevenLabsKeysUnavailableError(
          lastDetail,
          `Giọng «${options.voiceName || selectedVoiceId}» vẫn được giữ (không đổi sang giọng khác).`
        )
      );
    }

    ElevenLabsKeyManager.markBusy(record.id);

    try {
      // Bổ sung meta từ key đầu tiên nếu draft chưa có publicOwnerId.
      if (!shareMeta) {
        shareMeta =
          (await fetchVoiceShareMeta(record.apiKey, selectedVoiceId)) ||
          (await searchLibraryShareMeta(record.apiKey, {
            voiceId: libraryVoiceId,
            name: options.voiceName,
          }));
      }

      // Library → tự Add vào account của key này nếu chưa có (cùng giọng, có thể khác voice_id).
      let effectiveVoiceId = selectedVoiceId;
      if (shareMeta?.publicOwnerId) {
        const ensured = await ensureLibraryVoiceOnApiKey({
          apiKey: record.apiKey,
          apiKeyId: record.id,
          selectedVoiceId,
          meta: shareMeta,
        });
        effectiveVoiceId = ensured.voiceId;
        if (ensured.meta) shareMeta = ensured.meta;
      }

      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(effectiveVoiceId)}/with-timestamps?output_format=mp3_44100_128`;
      const res = await elevenLabsFetchWithKey(record.apiKey, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as TtsWithTimestampsResponse;

      if (res.ok && data.audio_base64) {
        ElevenLabsKeyManager.markSuccess(record.id);
        const audioPath = path.join(options.outDir, options.fileName || 'narration.mp3');
        fs.writeFileSync(audioPath, Buffer.from(data.audio_base64, 'base64'));
        const words = alignmentToWords(data.normalized_alignment || data.alignment);
        const srtPath = path.join(options.outDir, 'subs.srt');
        fs.writeFileSync(srtPath, wordsToSrt(words), 'utf8');
        return { audioPath, srtPath, words, modelId };
      }

      const detail =
        typeof data.detail === 'string'
          ? data.detail
          : data.detail?.message || JSON.stringify(data).slice(0, 300);
      lastDetail = detail;

      // Giọng thiếu trên key → thử Add rồi TTS lại 1 lần.
      if (
        shareMeta?.publicOwnerId &&
        /voice_not_found|invalid.?voice|unknown voice|does not exist|library voices/i.test(detail)
      ) {
        try {
          const ensured = await ensureLibraryVoiceOnApiKey({
            apiKey: record.apiKey,
            apiKeyId: record.id,
            selectedVoiceId,
            meta: shareMeta,
          });
          const retryUrl = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ensured.voiceId)}/with-timestamps?output_format=mp3_44100_128`;
          const retry = await elevenLabsFetchWithKey(record.apiKey, retryUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const retryData = (await retry.json()) as TtsWithTimestampsResponse;
          if (retry.ok && retryData.audio_base64) {
            ElevenLabsKeyManager.markSuccess(record.id);
            const audioPath = path.join(options.outDir, options.fileName || 'narration.mp3');
            fs.writeFileSync(audioPath, Buffer.from(retryData.audio_base64, 'base64'));
            const words = alignmentToWords(
              retryData.normalized_alignment || retryData.alignment
            );
            const srtPath = path.join(options.outDir, 'subs.srt');
            fs.writeFileSync(srtPath, wordsToSrt(words), 'utf8');
            return { audioPath, srtPath, words, modelId };
          }
          lastDetail =
            typeof retryData.detail === 'string'
              ? retryData.detail
              : retryData.detail?.message || detail;
        } catch (addErr) {
          lastDetail = addErr instanceof Error ? addErr.message : String(addErr);
        }
      }

      if (res.status === 402 && /library voices/i.test(detail)) {
        // Gói Free không TTS Library — thử key khác (có thể paid), không đổi giọng.
        ElevenLabsKeyManager.markReady(record.id);
        tried.add(record.id);
        continue;
      }

      const kind = ElevenLabsKeyManager.applyHttpFailure(record.id, res.status, detail);
      if (kind === 'fatal') {
        if (res.status === 401) {
          throw new Error(
            'ElevenLabs API key không hợp lệ (HTTP 401). Vào Settings → lưu lại API key mới.'
          );
        }
        throw new Error(`ElevenLabs TTS failed: HTTP ${res.status} ${detail}`);
      }
      tried.add(record.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastDetail = msg;
      if (/HTTP 401|không hợp lệ|TTS failed: HTTP 4[0-2]/i.test(msg) && !/402|library/i.test(msg)) {
        // fatal đã throw phía trên; các lỗi khác → thử key tiếp
      }
      if (/Thiếu|empty text|không hợp lệ \(HTTP 401\)|TTS failed: HTTP 422/i.test(msg)) {
        throw err;
      }
      ElevenLabsKeyManager.markReady(record.id);
      tried.add(record.id);
    }
  }
}

/** Short TTS sample when voice has no preview_url (uses quota). */
export async function previewElevenLabsVoice(options: {
  voiceId: string;
  modelId?: string;
  language?: string;
}): Promise<{ dataUrl: string }> {
  const workDir = path.join(os.tmpdir(), 'snapgen-el-preview');
  const result = await synthesizeWithElevenLabs({
    text: 'Xin chào. Đây là bản nghe thử giọng đọc của SnapGen.',
    voiceId: options.voiceId,
    modelId: options.modelId,
    language: options.language || 'vi',
    outDir: workDir,
    fileName: `preview-${options.voiceId.replace(/[^\w-]/g, '').slice(0, 24) || 'voice'}.mp3`,
  });
  const buf = fs.readFileSync(result.audioPath);
  return { dataUrl: `data:audio/mpeg;base64,${buf.toString('base64')}` };
}

export const ELEVENLABS_TTS_MODELS = [
  'eleven_flash_v2_5',
  'eleven_turbo_v2_5',
  'eleven_v3',
  'eleven_multilingual_v2',
] as const;
