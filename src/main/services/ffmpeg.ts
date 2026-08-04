import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ffmpeg from 'fluent-ffmpeg';
import { removeGeminiWatermarkFromFile } from './gemini-watermark';

const require = createRequire(import.meta.url);

// Packaged builds run from inside app.asar, where binaries are not executable.
function unpacked(binPath: string): string {
  return binPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

function resolveFfmpegPath(): string {
  try {
    const p = require('ffmpeg-static') as string | null;
    if (p) {
      const resolved = unpacked(p);
      if (fs.existsSync(resolved)) return resolved;
    }
  } catch {
    /* use PATH */
  }
  return 'ffmpeg';
}

function resolveFfprobePath(): string {
  try {
    const mod = require('ffprobe-static') as { path?: string } | string | null;
    const p = typeof mod === 'string' ? mod : mod?.path;
    if (p) {
      const resolved = unpacked(p);
      if (fs.existsSync(resolved)) return resolved;
    }
  } catch {
    /* use PATH */
  }
  return 'ffprobe';
}

ffmpeg.setFfmpegPath(resolveFfmpegPath());
ffmpeg.setFfprobePath(resolveFfprobePath());

function run(cmd: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    cmd
      .on('stderr', (line: string) => {
        if (lines.length < 40) lines.push(line);
      })
      .on('end', () => resolve())
      .on('error', (err: Error) => {
        const hint = lines.filter((l) => /error|invalid|failed|outside|unable/i.test(l)).slice(-6);
        if (hint.length) {
          reject(new Error(`${err.message}\n${hint.join('\n')}`));
        } else {
          reject(err);
        }
      })
      .run();
  });
}

type VideoEncoderKind = 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libx264';

interface VideoEncoder {
  kind: VideoEncoderKind;
  /** Options sau `-c:v` (không gồm chính codec name). */
  options: string[];
}

let cachedEncoder: VideoEncoder | null = null;
let encoderProbe: Promise<VideoEncoder> | null = null;

function cpuEncoder(): VideoEncoder {
  return {
    kind: 'libx264',
    // ultrafast + threads = nhanh hơn rất nhiều so với veryfast/medium trên CPU
    options: ['-preset', 'ultrafast', '-crf', '23', '-threads', '0', '-pix_fmt', 'yuv420p'],
  };
}

async function tryGpuEncoder(kind: Exclude<VideoEncoderKind, 'libx264'>): Promise<boolean> {
  const work = path.join(os.tmpdir(), `snapgen-enc-probe-${kind}-${process.pid}.mp4`);
  try {
    const opts =
      kind === 'h264_nvenc'
        ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23', '-pix_fmt', 'yuv420p']
        : kind === 'h264_qsv'
          ? ['-c:v', 'h264_qsv', '-global_quality', '23', '-pix_fmt', 'yuv420p']
          : ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '22', '-pix_fmt', 'yuv420p'];
    await run(
      ffmpeg()
        .input('color=c=black:s=160x90:d=0.2')
        .inputOptions(['-f', 'lavfi'])
        .outputOptions([...opts, '-an', '-t', '0.2', '-y'])
        .output(work)
    );
    return true;
  } catch {
    return false;
  } finally {
    try {
      if (fs.existsSync(work)) fs.unlinkSync(work);
    } catch {
      /* ignore */
    }
  }
}

/** Chọn encoder nhanh nhất máy hỗ trợ (GPU → CPU ultrafast). Cache 1 lần/process. */
async function resolveVideoEncoder(): Promise<VideoEncoder> {
  if (cachedEncoder) return cachedEncoder;
  if (!encoderProbe) {
    encoderProbe = (async () => {
      const order: Array<Exclude<VideoEncoderKind, 'libx264'>> = [
        'h264_nvenc',
        'h264_qsv',
        'h264_amf',
      ];
      for (const kind of order) {
        if (await tryGpuEncoder(kind)) {
          if (kind === 'h264_nvenc') {
            return {
              kind,
              options: ['-preset', 'p4', '-cq', '23', '-pix_fmt', 'yuv420p'],
            };
          }
          if (kind === 'h264_qsv') {
            return {
              kind,
              options: ['-global_quality', '23', '-pix_fmt', 'yuv420p'],
            };
          }
          return {
            kind,
            options: ['-quality', 'speed', '-rc', 'cqp', '-qp_i', '22', '-pix_fmt', 'yuv420p'],
          };
        }
      }
      return cpuEncoder();
    })();
  }
  cachedEncoder = await encoderProbe;
  return cachedEncoder;
}

function applyVideoEncoder(
  cmd: ffmpeg.FfmpegCommand,
  encoder: VideoEncoder,
  extra: string[] = []
): ffmpeg.FfmpegCommand {
  return cmd.outputOptions(['-c:v', encoder.kind, ...encoder.options, ...extra]);
}

/** Chạy tối đa `concurrency` task song song (giữ thứ tự kết quả). */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    })
  );
  return results;
}

function encodeConcurrency(): number {
  try {
    const cpus = os.cpus()?.length || 4;
    return Math.max(2, Math.min(4, Math.floor(cpus / 2) || 2));
  } catch {
    return 2;
  }
}

/** nano-banana / Gemini thường gắn sparkle logo góc dưới-phải. */
export function isNanoBananaModel(modelId: string): boolean {
  return /nano-banana/i.test(modelId);
}

async function probeImageSize(imagePath: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(imagePath, (err, data) => {
      if (err) {
        resolve(null);
        return;
      }
      const stream = data.streams?.find((s) => s.width && s.height);
      if (!stream?.width || !stream?.height) {
        resolve(null);
        return;
      }
      resolve({ width: stream.width, height: stream.height });
    });
  });
}

/**
 * Xóa watermark sparkle Gemini / nano-banana góc dưới-phải.
 * Ưu tiên @pilio/gemini-watermark-remover (reverse alpha blending).
 * Fallback FFmpeg delogo với tọa độ pixel cố định nếu engine bỏ qua / lỗi.
 */
export async function stripNanoBananaWatermark(imagePath: string): Promise<void> {
  if (!fs.existsSync(imagePath)) return;

  try {
    const applied = await removeGeminiWatermarkFromFile(imagePath);
    if (applied) return;
  } catch {
    // Fall through to delogo fallback.
  }

  const size = await probeImageSize(imagePath);
  if (!size) return;

  const logoW = Math.max(12, Math.floor(size.width * 0.085));
  const logoH = Math.max(12, Math.floor(size.height * 0.085));
  const x = Math.max(0, size.width - logoW - 2);
  const y = Math.max(0, size.height - logoH - 2);
  if (x + logoW > size.width || y + logoH > size.height) return;

  const ext = path.extname(imagePath) || '.png';
  const tmp = path.join(
    path.dirname(imagePath),
    `.wm-strip-${process.pid}-${Date.now()}${ext}`
  );
  try {
    await run(
      ffmpeg(imagePath)
        .inputOptions(['-loop', '1'])
        .videoFilters([`delogo=x=${x}:y=${y}:w=${logoW}:h=${logoH}:show=0`])
        .outputOptions(['-frames:v', '1', '-update', '1', '-y'])
        .output(tmp)
    );
    fs.renameSync(tmp, imagePath);
  } catch {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export async function getDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(Number(data.format.duration) || 0);
    });
  });
}

// ffprobe can be missing on some setups; fall back to a caller-supplied estimate
// so a finished render is never thrown away over a duration lookup.
export async function getDurationSafe(filePath: string, fallback: number): Promise<number> {
  try {
    const duration = await getDurationSeconds(filePath);
    return duration > 0 ? duration : fallback;
  } catch {
    return fallback;
  }
}

export type NarrationTrackItem =
  | { kind: 'slice'; start: number; end: number }
  | { kind: 'silence'; duration: number };

/**
 * Dựng narration.mp3 từ bản đọc liền mạch: giữ nguyên các lát nói,
 * chỉ chèn im lặng cho scene không có lời thoại.
 */
export async function buildNarrationTrack(options: {
  sourcePath: string;
  items: NarrationTrackItem[];
  outputPath: string;
  workDir: string;
}): Promise<string> {
  const { sourcePath, items, outputPath, workDir } = options;
  if (!items.length) throw new Error('No narration items to build.');

  fs.mkdirSync(workDir, { recursive: true });
  const parts: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const out = path.join(workDir, `narr-${i}.mp3`);

    if (item.kind === 'silence') {
      await run(
        ffmpeg()
          .input('anullsrc=r=44100:cl=mono')
          .inputOptions(['-f', 'lavfi'])
          .outputOptions([
            '-t',
            Math.max(0.1, item.duration).toFixed(3),
            '-c:a',
            'libmp3lame',
            '-q:a',
            '4',
          ])
          .output(out)
      );
    } else {
      const length = Math.max(0.05, item.end - item.start);
      await run(
        ffmpeg(sourcePath)
          .inputOptions(['-ss', item.start.toFixed(3)])
          .outputOptions([
            '-t',
            length.toFixed(3),
            '-c:a',
            'libmp3lame',
            '-q:a',
            '4',
            '-ar',
            '44100',
            '-ac',
            '1',
          ])
          .output(out)
      );
    }
    parts.push(out);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (parts.length === 1) {
    fs.copyFileSync(parts[0], outputPath);
    return outputPath;
  }

  const listFile = path.join(workDir, 'narr-concat.txt');
  fs.writeFileSync(
    listFile,
    parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
    'utf8'
  );
  await run(
    ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(outputPath)
  );
  return outputPath;
}

export async function concatClipFiles(
  clipPaths: string[],
  outputPath: string,
  workDir: string
): Promise<string> {
  if (!clipPaths.length) throw new Error('No clips to concat.');
  if (clipPaths.length === 1) {
    fs.copyFileSync(clipPaths[0], outputPath);
    return outputPath;
  }

  fs.mkdirSync(workDir, { recursive: true });
  const encoder = await resolveVideoEncoder();
  const normalized = await mapPool(clipPaths, encodeConcurrency(), async (clipPath, i) => {
    const out = path.join(workDir, `seg-${i}.mp4`);
    const cmd = ffmpeg(clipPath).videoFilters([
      'scale=1280:720:force_original_aspect_ratio=decrease',
      'pad=1280:720:(ow-iw)/2:(oh-ih)/2:black',
      'fps=30',
    ]);
    applyVideoEncoder(cmd, encoder, ['-an', '-r', '30']);
    await run(cmd.output(out));
    return out;
  });

  const listFile = path.join(workDir, 'seg-concat.txt');
  fs.writeFileSync(
    listFile,
    normalized.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
    'utf8'
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await run(
    ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(outputPath)
  );
  return outputPath;
}

export async function assembleFinalVideo(options: {
  clipPaths: string[];
  audioPath: string;
  srtPath: string;
  outputPath: string;
  burnSubtitles: boolean;
  workDir: string;
  estimatedTotalSeconds?: number;
  clipDurations?: number[];
  /** When clips are already 1280x720@30 (e.g. Ken Burns slides), skip re-encode. */
  skipClipNormalize?: boolean;
}): Promise<string> {
  const { clipPaths, audioPath, srtPath, outputPath, burnSubtitles, workDir } = options;
  if (!clipPaths.length) throw new Error('No clips to assemble.');

  fs.mkdirSync(workDir, { recursive: true });
  const encoder = await resolveVideoEncoder();

  // Hard cuts between scenes — fit each clip to planned duration.
  // Longer than natural: freeze last frame (tpad). Shorter: trim with -t.
  // Encode song song (GPU/CPU) để rút ngắn thời gian merge.
  const normalized = await mapPool(clipPaths, encodeConcurrency(), async (clipPath, i) => {
    const out = path.join(workDir, `clip-${i}.mp4`);
    if (options.skipClipNormalize) {
      const planned = options.clipDurations?.[i];
      const natural = await getDurationSafe(clipPath, planned ?? 8);
      if (planned == null || Math.abs(planned - natural) <= 0.08) {
        fs.copyFileSync(clipPath, out);
        return out;
      }
      // Duration mismatch: only trim/pad, do not re-scale (keeps Ken Burns smooth).
      const filters: string[] = [];
      if (planned > natural + 0.05) {
        filters.push(`tpad=stop_mode=clone:stop_duration=${(planned - natural).toFixed(3)}`);
      }
      if (!filters.length) {
        const cmd = ffmpeg(clipPath).outputOptions(['-an', '-c:v', 'copy']);
        if (planned) cmd.outputOptions(['-t', String(planned)]);
        await run(cmd.output(out));
        return out;
      }
      const cmd = ffmpeg(clipPath).videoFilters(filters);
      applyVideoEncoder(cmd, encoder, ['-an', '-r', '30']);
      if (planned) cmd.outputOptions(['-t', String(planned)]);
      await run(cmd.output(out));
      return out;
    }

    const natural = await getDurationSafe(clipPath, options.clipDurations?.[i] ?? 8);
    const planned = options.clipDurations?.[i];
    const filters = [
      'scale=1280:720:force_original_aspect_ratio=decrease',
      'pad=1280:720:(ow-iw)/2:(oh-ih)/2:black',
      'fps=30',
    ];
    if (planned != null && planned > natural + 0.05) {
      filters.push(`tpad=stop_mode=clone:stop_duration=${(planned - natural).toFixed(3)}`);
    }

    const cmd = ffmpeg(clipPath).videoFilters(filters);
    applyVideoEncoder(cmd, encoder, ['-an', '-r', '30']);
    if (planned) cmd.outputOptions(['-t', String(planned)]);
    await run(cmd.output(out));
    return out;
  });

  const listFile = path.join(workDir, 'concat.txt');
  fs.writeFileSync(
    listFile,
    normalized.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
    'utf8'
  );

  const silentConcat = path.join(workDir, 'video-silent.mp4');
  await run(
    ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(silentConcat)
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // The narration is usually shorter than the footage. `-shortest` would cut the
  // video down to the audio, dropping whole scenes, so instead pad the audio with
  // silence and clamp the output to the full video length.
  const plannedTotal =
    options.estimatedTotalSeconds ??
    options.clipDurations?.reduce((sum, value) => sum + value, 0) ??
    0;
  const videoDuration = await getDurationSafe(silentConcat, plannedTotal);
  const lengthOptions = videoDuration > 0 ? ['-t', videoDuration.toFixed(3)] : ['-shortest'];

  if (burnSubtitles) {
    const srtEscaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    const cmd = ffmpeg()
      .input(silentConcat)
      .input(audioPath)
      .videoFilters(`subtitles='${srtEscaped}'`)
      .audioFilters('apad');
    applyVideoEncoder(cmd, encoder, ['-c:a', 'aac', ...lengthOptions]);
    await run(cmd.output(outputPath));
  } else {
    await run(
      ffmpeg()
        .input(silentConcat)
        .input(audioPath)
        .audioFilters('apad')
        .outputOptions(['-c:v', 'copy', '-c:a', 'aac', ...lengthOptions])
        .output(outputPath)
    );
  }

  const beside = outputPath.replace(/\.mp4$/i, '.srt');
  if (path.resolve(srtPath) !== path.resolve(beside)) {
    fs.copyFileSync(srtPath, beside);
  }

  return outputPath;
}

/**
 * Ken Burns — zoom-in only, smooth push-in then hold.
 * Target ~115% (within 110–120%). Ease-in-out so motion feels like a
 * gentle camera move, not a linear crawl. High-res source + zoompan to
 * 1080p then lanczos down to 720p reduces sub-pixel shake.
 */
function kenBurnsFilters(durationSec: number): string[] {
  // 30fps đủ mượt cho slideshow; bỏ oversample 5K → nhanh hơn rõ khi merge ảnh.
  const renderFps = 30;
  const outFps = 30;
  const frames = Math.max(Math.round(durationSec * renderFps), renderFps);
  const last = Math.max(frames - 1, 1);
  const zMax = 1.15;
  const delta = zMax - 1;

  const t = `min(1\\,on/${last})`;
  const zExpr = `1+${delta.toFixed(8)}*((${t})*(${t})*(3-2*(${t})))`;

  return [
    'scale=2560:1440:force_original_aspect_ratio=increase:flags=bilinear',
    'crop=2560:1440',
    'setsar=1',
    'format=yuv420p',
    `zoompan=z='${zExpr}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=${renderFps}`,
    `fps=${outFps}`,
  ];
}

export async function assembleSlideshowFromImages(options: {
  imagePaths: string[];
  audioPath: string;
  srtPath: string;
  outputPath: string;
  burnSubtitles: boolean;
  workDir: string;
  durations?: number[];
  /** Strip nano-banana watermark on each still before Ken Burns (safe, isolated). */
  stripCornerLogo?: boolean;
}): Promise<string> {
  const {
    imagePaths,
    audioPath,
    srtPath,
    outputPath,
    burnSubtitles,
    workDir,
    durations,
    stripCornerLogo = false,
  } = options;
  if (!imagePaths.length) throw new Error('No images to assemble.');

  fs.mkdirSync(workDir, { recursive: true });
  const estimatedTotal = durations?.reduce((sum, value) => sum + value, 0) || imagePaths.length * 5;
  const audioDur = await getDurationSafe(audioPath, estimatedTotal);
  const fallback = Math.max(audioDur / imagePaths.length, 1);
  const encoder = await resolveVideoEncoder();

  const clips = await mapPool(imagePaths, encodeConcurrency(), async (imagePath, i) => {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Thiếu ảnh scene ${i + 1}: ${imagePath}`);
    }
    if (stripCornerLogo) {
      await stripNanoBananaWatermark(imagePath);
    }
    const out = path.join(workDir, `img-clip-${i}.mp4`);
    const dur = Math.max(durations?.[i] ?? fallback, 1);
    const outFrames = Math.max(Math.round(dur * 30), 30);
    try {
      const cmd = ffmpeg(imagePath)
        .inputOptions(['-loop', '1', '-framerate', '30'])
        .videoFilters(kenBurnsFilters(dur));
      applyVideoEncoder(cmd, encoder, [
        '-frames:v',
        String(outFrames),
        '-an',
        '-r',
        '30',
      ]);
      await run(cmd.output(out));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `FFmpeg lỗi khi tạo clip ảnh scene ${i + 1} (${path.basename(imagePath)}): ${detail}`
      );
    }
    return out;
  });

  // Write to a temp file then rename so the UI never opens a half-written final.mp4.
  const tempOutput = path.join(workDir, `final-build-${Date.now()}.mp4`);
  await assembleFinalVideo({
    clipPaths: clips,
    audioPath,
    srtPath,
    outputPath: tempOutput,
    burnSubtitles,
    workDir,
    estimatedTotalSeconds: estimatedTotal,
    clipDurations: durations,
    skipClipNormalize: true,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  try {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  } catch {
    // ignore locked file — rename may still replace on Windows
  }
  fs.renameSync(tempOutput, outputPath);

  const beside = outputPath.replace(/\.mp4$/i, '.srt');
  const tempSrt = tempOutput.replace(/\.mp4$/i, '.srt');
  if (fs.existsSync(tempSrt)) {
    try {
      if (fs.existsSync(beside)) fs.unlinkSync(beside);
      fs.renameSync(tempSrt, beside);
    } catch {
      fs.copyFileSync(tempSrt, beside);
    }
  }

  return outputPath;
}
