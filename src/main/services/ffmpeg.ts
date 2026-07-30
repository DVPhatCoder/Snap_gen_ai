import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ffmpeg from 'fluent-ffmpeg';

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
    cmd.on('end', () => resolve()).on('error', (err) => reject(err)).run();
  });
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
  const normalized: string[] = [];
  for (let i = 0; i < clipPaths.length; i++) {
    const out = path.join(workDir, `seg-${i}.mp4`);
    await run(
      ffmpeg(clipPaths[i])
        .videoFilters([
          'scale=1280:720:force_original_aspect_ratio=decrease',
          'pad=1280:720:(ow-iw)/2:(oh-ih)/2:black',
          'fps=30',
        ])
        .outputOptions(['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', '30'])
        .output(out)
    );
    normalized.push(out);
  }

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
}): Promise<string> {
  const { clipPaths, audioPath, srtPath, outputPath, burnSubtitles, workDir } = options;
  if (!clipPaths.length) throw new Error('No clips to assemble.');

  fs.mkdirSync(workDir, { recursive: true });

  // Hard cuts between scenes — fit each clip to planned duration.
  // Longer than natural: freeze last frame (tpad). Shorter: trim with -t.
  const normalized: string[] = [];
  for (let i = 0; i < clipPaths.length; i++) {
    const out = path.join(workDir, `clip-${i}.mp4`);
    const natural = await getDurationSafe(clipPaths[i], options.clipDurations?.[i] ?? 8);
    const planned = options.clipDurations?.[i];
    const filters = [
      'scale=1280:720:force_original_aspect_ratio=decrease',
      'pad=1280:720:(ow-iw)/2:(oh-ih)/2:black',
      'fps=30',
    ];
    if (planned != null && planned > natural + 0.05) {
      filters.push(`tpad=stop_mode=clone:stop_duration=${(planned - natural).toFixed(3)}`);
    }

    const cmd = ffmpeg(clipPaths[i]).videoFilters(filters).outputOptions([
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
    ]);
    if (planned) cmd.outputOptions(['-t', String(planned)]);
    await run(cmd.output(out));
    normalized.push(out);
  }

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
    await run(
      ffmpeg()
        .input(silentConcat)
        .input(audioPath)
        .videoFilters(`subtitles='${srtEscaped}'`)
        .audioFilters('apad')
        .outputOptions([
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-c:a',
          'aac',
          '-pix_fmt',
          'yuv420p',
          ...lengthOptions,
        ])
        .output(outputPath)
    );
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

export async function assembleSlideshowFromImages(options: {
  imagePaths: string[];
  audioPath: string;
  srtPath: string;
  outputPath: string;
  burnSubtitles: boolean;
  workDir: string;
  durations?: number[];
}): Promise<string> {
  const { imagePaths, audioPath, srtPath, outputPath, burnSubtitles, workDir, durations } =
    options;
  if (!imagePaths.length) throw new Error('No images to assemble.');

  fs.mkdirSync(workDir, { recursive: true });
  const estimatedTotal = durations?.reduce((sum, value) => sum + value, 0) || imagePaths.length * 5;
  const audioDur = await getDurationSafe(audioPath, estimatedTotal);
  const fallback = Math.max(audioDur / imagePaths.length, 1);

  const clips: string[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const out = path.join(workDir, `img-clip-${i}.mp4`);
    const dur = Math.max(durations?.[i] ?? fallback, 1);
    await run(
      ffmpeg(imagePaths[i])
        .inputOptions(['-loop', '1', '-t', String(dur)])
        .videoFilters([
          'scale=1280:720:force_original_aspect_ratio=decrease',
          'pad=1280:720:(ow-iw)/2:(oh-ih)/2:black',
          'fps=30',
        ])
        .outputOptions([
          '-t',
          String(dur),
          '-an',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-pix_fmt',
          'yuv420p',
          '-r',
          '30',
        ])
        .output(out)
    );
    clips.push(out);
  }

  return assembleFinalVideo({
    clipPaths: clips,
    audioPath,
    srtPath,
    outputPath,
    burnSubtitles,
    workDir,
    estimatedTotalSeconds: estimatedTotal,
    clipDurations: durations,
  });
}
