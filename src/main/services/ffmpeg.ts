import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ffmpeg from 'fluent-ffmpeg';

const require = createRequire(import.meta.url);

function resolveFfmpegPath(): string {
  try {
    const p = require('ffmpeg-static') as string | null;
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* use PATH */
  }
  return 'ffmpeg';
}

ffmpeg.setFfmpegPath(resolveFfmpegPath());

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

export async function assembleFinalVideo(options: {
  clipPaths: string[];
  audioPath: string;
  srtPath: string;
  outputPath: string;
  burnSubtitles: boolean;
  workDir: string;
}): Promise<string> {
  const { clipPaths, audioPath, srtPath, outputPath, burnSubtitles, workDir } = options;
  if (!clipPaths.length) throw new Error('No clips to assemble.');

  fs.mkdirSync(workDir, { recursive: true });
  const audioDur = await getDurationSeconds(audioPath);
  const perClip = Math.max(audioDur / clipPaths.length, 1);

  const normalized: string[] = [];
  for (let i = 0; i < clipPaths.length; i++) {
    const out = path.join(workDir, `clip-${i}.mp4`);
    const dur = await getDurationSeconds(clipPaths[i]);
    const factor = dur > 0 ? perClip / dur : 1;
    await run(
      ffmpeg(clipPaths[i])
        .videoFilters([
          `setpts=${factor.toFixed(6)}*PTS`,
          'scale=1280:720:force_original_aspect_ratio=decrease',
          'pad=1280:720:(ow-iw)/2:(oh-ih)/2:black',
        ])
        .outputOptions([
          '-t',
          String(perClip),
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

  if (burnSubtitles) {
    const srtEscaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    await run(
      ffmpeg()
        .input(silentConcat)
        .input(audioPath)
        .videoFilters(`subtitles='${srtEscaped}'`)
        .outputOptions([
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-c:a',
          'aac',
          '-shortest',
          '-pix_fmt',
          'yuv420p',
        ])
        .output(outputPath)
    );
  } else {
    await run(
      ffmpeg()
        .input(silentConcat)
        .input(audioPath)
        .outputOptions(['-c:v', 'copy', '-c:a', 'aac', '-shortest'])
        .output(outputPath)
    );
  }

  const beside = outputPath.replace(/\.mp4$/i, '.srt');
  if (path.resolve(srtPath) !== path.resolve(beside)) {
    fs.copyFileSync(srtPath, beside);
  }

  return outputPath;
}
