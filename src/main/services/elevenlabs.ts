import fs from 'node:fs';
import path from 'node:path';

export interface ElevenVoice {
  voice_id: string;
  name: string;
}

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface TtsWithTimestamps {
  audio_base64: string;
  alignment?: Alignment;
  normalized_alignment?: Alignment;
}

function formatSrtTime(seconds: number): string {
  const msTotal = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(msTotal / 3_600_000);
  const m = Math.floor((msTotal % 3_600_000) / 60_000);
  const s = Math.floor((msTotal % 60_000) / 1000);
  const ms = msTotal % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function alignmentToSrt(alignment: Alignment, maxChars = 42): string {
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  if (!chars?.length) return '';

  type Cue = { start: number; end: number; text: string };
  const cues: Cue[] = [];
  let buf = '';
  let cueStart = starts[0] ?? 0;
  let cueEnd = ends[0] ?? 0;

  const flush = () => {
    const text = buf.replace(/\s+/g, ' ').trim();
    if (text) cues.push({ start: cueStart, end: cueEnd, text });
    buf = '';
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (!buf) cueStart = starts[i] ?? cueStart;
    cueEnd = ends[i] ?? cueEnd;
    buf += ch;

    const isBreak =
      ch === '\n' ||
      ((ch === '.' || ch === '!' || ch === '?' || ch === '。') && buf.trim().length > 8) ||
      (ch === ' ' && buf.trim().length >= maxChars);

    if (isBreak) flush();
  }
  flush();

  return cues
    .map(
      (c, idx) =>
        `${idx + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(Math.max(c.end, c.start + 0.4))}\n${c.text}\n`
    )
    .join('\n');
}

export async function testElevenLabs(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, message: `HTTP ${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true, message: 'ElevenLabs API key hợp lệ.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function listVoices(apiKey: string): Promise<ElevenVoice[]> {
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
  });
  const data = (await res.json()) as { voices?: ElevenVoice[]; detail?: unknown };
  if (!res.ok) throw new Error(`List voices failed: HTTP ${res.status}`);
  return (data.voices ?? []).map((v) => ({ voice_id: v.voice_id, name: v.name }));
}

export async function synthesizeNarration(options: {
  apiKey: string;
  voiceId: string;
  text: string;
  outDir: string;
}): Promise<{ audioPath: string; srtPath: string }> {
  const { apiKey, voiceId, text, outDir } = options;
  fs.mkdirSync(outDir, { recursive: true });

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      output_format: 'mp3_44100_128',
    }),
  });

  const data = (await res.json()) as TtsWithTimestamps & { detail?: unknown };
  if (!res.ok || !data.audio_base64) {
    throw new Error(`ElevenLabs TTS failed: HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }

  const audioPath = path.join(outDir, 'narration.mp3');
  fs.writeFileSync(audioPath, Buffer.from(data.audio_base64, 'base64'));

  const alignment = data.normalized_alignment || data.alignment;
  const srt = alignment ? alignmentToSrt(alignment) : `1\n00:00:00,000 --> 00:00:10,000\n${text.slice(0, 80)}\n`;
  const srtPath = path.join(outDir, 'subs.srt');
  fs.writeFileSync(srtPath, srt, 'utf8');

  return { audioPath, srtPath };
}
