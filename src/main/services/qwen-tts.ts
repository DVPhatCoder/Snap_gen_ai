import fs from 'node:fs';
import path from 'node:path';
import type { ConnectionTestResult, DashScopeRegion } from '../../shared/types';
import { isQwenInstructModel } from '../../shared/voice';
import {
  buildContinuousNarrationText,
  type SceneNarrationInput,
  type TranscriptWord,
  transcribeWithWords,
} from './openai-audio';
import { concatAudioFiles } from './ffmpeg';

const MAX_CHUNK_CHARS = 580;

const DASHSCOPE_URLS: Record<DashScopeRegion, string> = {
  intl: 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  cn: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
};

export function resolveQwenLanguageType(language?: string | null): string {
  const raw = (language || '').toLowerCase().trim();
  if (!raw) return 'Auto';
  if (raw.includes('vi') || raw.includes('việt') || raw.includes('viet')) return 'Auto';
  if (raw.includes('zh') || raw.includes('trung') || raw.includes('chinese') || raw.includes('中'))
    return 'Chinese';
  if (raw.includes('ja') || raw.includes('nhật') || raw.includes('japan')) return 'Japanese';
  if (raw.includes('ko') || raw.includes('hàn') || raw.includes('korea')) return 'Korean';
  if (raw.includes('fr') || raw.includes('pháp') || raw.includes('french')) return 'French';
  if (raw.includes('de') || raw.includes('đức') || raw.includes('german')) return 'German';
  if (raw.includes('es') || raw.includes('tây ban') || raw.includes('spanish')) return 'Spanish';
  if (raw.includes('pt') || raw.includes('bồ') || raw.includes('portug')) return 'Portuguese';
  if (raw.includes('it') || raw.includes('ý') || raw.includes('ital')) return 'Italian';
  if (raw.includes('ru') || raw.includes('nga') || raw.includes('russ')) return 'Russian';
  if (raw.includes('en') || raw.includes('anh') || raw.includes('english')) return 'English';
  return 'Auto';
}

function chunkText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const sentences = cleaned.split(/(?<=[.!?…。！？])\s+/);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current) {
      chunks.push(current.trim());
      current = '';
    }
  };

  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (piece.length > maxChars) {
      flush();
      const words = piece.split(' ');
      let buf = '';
      for (const word of words) {
        const next = buf ? `${buf} ${word}` : word;
        if (buf && next.length > maxChars) {
          chunks.push(buf);
          buf = word;
        } else {
          buf = next;
        }
      }
      if (buf) chunks.push(buf);
      continue;
    }
    const next = current ? `${current} ${piece}` : piece;
    if (next.length <= maxChars) current = next;
    else {
      flush();
      current = piece;
    }
  }
  flush();
  return chunks;
}

async function callQwenTtsOnce(options: {
  apiKey: string;
  text: string;
  voice: string;
  model: string;
  languageType: string;
  instructions?: string;
  region: DashScopeRegion;
}): Promise<Buffer> {
  const input: Record<string, unknown> = {
    text: options.text,
    voice: options.voice,
    language_type: options.languageType,
  };
  if (isQwenInstructModel(options.model) && options.instructions?.trim()) {
    input.instructions = options.instructions.trim();
    input.optimize_instructions = true;
  }

  const res = await fetch(DASHSCOPE_URLS[options.region], {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      input,
    }),
  });

  const rawText = await res.text();
  let json: {
    code?: string;
    message?: string;
    output?: { audio?: { url?: string; data?: string } };
  };
  try {
    json = JSON.parse(rawText) as typeof json;
  } catch {
    throw new Error(`Qwen TTS failed: HTTP ${res.status} ${rawText.slice(0, 300)}`);
  }

  if (!res.ok || json.code) {
    throw new Error(
      `Qwen TTS failed: ${json.code || `HTTP ${res.status}`} ${json.message || rawText.slice(0, 240)}`
    );
  }

  const url = json.output?.audio?.url?.trim();
  const b64 = json.output?.audio?.data?.trim();
  if (url) {
    const audioRes = await fetch(url);
    if (!audioRes.ok) {
      throw new Error(`Qwen TTS: không tải được audio URL (HTTP ${audioRes.status})`);
    }
    return Buffer.from(await audioRes.arrayBuffer());
  }
  if (b64) {
    return Buffer.from(b64, 'base64');
  }
  throw new Error('Qwen TTS: response thiếu audio url/data');
}

export async function synthesizeWithQwen(options: {
  apiKey: string;
  text: string;
  voice: string;
  model: string;
  language?: string;
  instructions?: string;
  region?: DashScopeRegion;
  outDir: string;
  fileName?: string;
  workDir?: string;
}): Promise<string> {
  const trimmed = options.text.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new Error('Qwen TTS: empty text');
  if (!options.apiKey.trim()) throw new Error('Thiếu DashScope API key (Qwen TTS).');

  fs.mkdirSync(options.outDir, { recursive: true });
  const workDir = options.workDir || path.join(options.outDir, 'qwen-chunks');
  fs.mkdirSync(workDir, { recursive: true });

  const region = options.region === 'cn' ? 'cn' : 'intl';
  const languageType = resolveQwenLanguageType(options.language);
  const pieces = chunkText(trimmed);
  const partPaths: string[] = [];

  for (let i = 0; i < pieces.length; i++) {
    const buf = await callQwenTtsOnce({
      apiKey: options.apiKey.trim(),
      text: pieces[i],
      voice: options.voice || 'Cherry',
      model: options.model || 'qwen3-tts-flash',
      languageType,
      instructions: options.instructions,
      region,
    });
    const partPath = path.join(workDir, `qwen-part-${String(i).padStart(3, '0')}.wav`);
    fs.writeFileSync(partPath, buf);
    partPaths.push(partPath);
  }

  const outPath = path.join(options.outDir, options.fileName || 'narration.mp3');
  if (partPaths.length === 1) {
    // Convert single wav → mp3 for pipeline consistency
    await concatAudioFiles(partPaths, outPath, workDir);
    return outPath;
  }
  await concatAudioFiles(partPaths, outPath, workDir);
  return outPath;
}

export async function synthesizeContinuousNarrationWithQwen(options: {
  dashscopeApiKey: string;
  openaiApiKey?: string;
  scenes: SceneNarrationInput[];
  voice: string;
  model: string;
  language?: string;
  instructions?: string;
  region?: DashScopeRegion;
  outDir: string;
  fileName?: string;
}): Promise<{ audioPath: string; srtPath: string; words: TranscriptWord[] }> {
  const text = buildContinuousNarrationText(options.scenes);
  if (!text) throw new Error('Kịch bản chưa có lời thoại để tạo voiceover.');

  const workDir = path.join(options.outDir, 'work');
  const audioPath = await synthesizeWithQwen({
    apiKey: options.dashscopeApiKey,
    text,
    voice: options.voice,
    model: options.model,
    language: options.language,
    instructions: options.instructions,
    region: options.region,
    outDir: options.outDir,
    fileName: options.fileName,
    workDir,
  });

  const srtPath = path.join(options.outDir, 'subs.srt');
  if (options.openaiApiKey?.trim()) {
    try {
      const transcribed = await transcribeWithWords({
        apiKey: options.openaiApiKey.trim(),
        audioPath,
        language: options.language,
        outDir: options.outDir,
      });
      return { audioPath, srtPath: transcribed.srtPath, words: transcribed.words };
    } catch {
      // Fallback: empty words → computeSceneTimings chia theo tỉ lệ ký tự
    }
  }

  if (!fs.existsSync(srtPath)) fs.writeFileSync(srtPath, '', 'utf8');
  return { audioPath, srtPath, words: [] };
}

export async function testDashScope(apiKey: string, region: DashScopeRegion = 'intl'): Promise<ConnectionTestResult> {
  const key = apiKey.trim();
  if (!key) {
    return { ok: false, message: 'Chưa nhập DashScope API key.' };
  }
  try {
    await callQwenTtsOnce({
      apiKey: key,
      text: 'Hello from SnapGen.',
      voice: 'Cherry',
      model: 'qwen3-tts-flash',
      languageType: 'English',
      region,
    });
    return {
      ok: true,
      message: `DashScope OK (Qwen TTS · region=${region}).`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
