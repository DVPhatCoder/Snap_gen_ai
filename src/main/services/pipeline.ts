import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc';
import { clampDuration } from '../../shared/models';
import type { GenerateJobInput, GenerateJobResult, JobProgress } from '../../shared/types';
import { getKeys, getProjectsRoot, getSettings } from '../store';
import { downloadFile, generateVideo, waitForVideo } from './snapgen';
import { synthesizeNarration } from './elevenlabs';
import { assembleFinalVideo } from './ffmpeg';

function emit(progress: JobProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.jobProgress, progress);
  }
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'project'
  );
}

export async function runGenerateJob(input: GenerateJobInput): Promise<GenerateJobResult> {
  const keys = getKeys();
  const settings = getSettings();

  if (!keys.snapgenApiKey) throw new Error('Thiếu Snapgen API key. Vào Settings để cấu hình.');
  if (!keys.elevenLabsApiKey) throw new Error('Thiếu ElevenLabs API key. Vào Settings để cấu hình.');

  const projectId = input.projectId || `${Date.now()}-${slugify(input.script.title)}`;
  const projectDir = path.join(getProjectsRoot(), projectId);
  const clipsDir = path.join(projectDir, 'clips');
  const workDir = path.join(projectDir, 'work');
  fs.mkdirSync(clipsDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  fs.writeFileSync(path.join(projectDir, 'script.json'), JSON.stringify(input, null, 2), 'utf8');

  emit({ phase: 'tts', message: 'Đang tạo voiceover ElevenLabs...', percent: 5 });
  const { audioPath, srtPath } = await synthesizeNarration({
    apiKey: keys.elevenLabsApiKey,
    voiceId: settings.elevenLabsVoiceId,
    text: input.script.narration,
    outDir: projectDir,
  });

  const scenes = input.script.scenes;
  const clipPaths: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const duration = clampDuration(input.model, scene.duration_hint);
    emit({
      phase: 'video',
      message: `Đang tạo video cảnh ${i + 1}/${scenes.length}...`,
      sceneIndex: i,
      sceneTotal: scenes.length,
      percent: 10 + Math.round((i / Math.max(scenes.length, 1)) * 70),
    });

    const job = await generateVideo({
      apiKey: keys.snapgenApiKey,
      family: input.family,
      model: input.model,
      prompt: scene.visual_prompt,
      duration,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      mode: input.mode,
    });

    const hist = await waitForVideo(keys.snapgenApiKey, job.uuid, (pct) => {
      emit({
        phase: 'video',
        message: `Cảnh ${i + 1}/${scenes.length}: ${pct}%`,
        sceneIndex: i,
        sceneTotal: scenes.length,
        percent: 10 + Math.round(((i + pct / 100) / Math.max(scenes.length, 1)) * 70),
      });
    });

    const url = hist.generated_video?.[0]?.video_url;
    if (!url) throw new Error(`Thiếu video_url cho scene ${i + 1}`);

    const clipPath = path.join(clipsDir, `scene-${i + 1}.mp4`);
    await downloadFile(url, clipPath);
    clipPaths.push(clipPath);
  }

  emit({ phase: 'merge', message: 'Đang ghép video + audio + subtitle...', percent: 88 });

  const outputPath = path.join(projectDir, 'final.mp4');
  await assembleFinalVideo({
    clipPaths,
    audioPath,
    srtPath,
    outputPath,
    burnSubtitles: input.burnSubtitles ?? settings.burnSubtitles,
    workDir,
  });

  emit({ phase: 'done', message: 'Hoàn tất!', percent: 100 });

  return {
    projectDir,
    videoPath: outputPath,
    srtPath,
    audioPath,
    title: input.script.title,
  };
}
