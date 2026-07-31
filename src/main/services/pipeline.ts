import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc';
import { planSceneChunks, withStylePrompt } from '../../shared/models';
import type {
  GenerateJobInput,
  GenerateJobResult,
  ImageFamily,
  JobProgress,
  MediaKind,
  ScriptDraft,
  VideoFamily,
} from '../../shared/types';
import { getKeys, getSettings } from '../store';
import {
  downloadFile,
  extendVideo,
  generateImage,
  generateVideo,
  getImageUrl,
  waitForMedia,
} from './snapgen';
import {
  buildContinuousNarrationText,
  computeSceneTimings,
  synthesizeContinuousNarration,
  type SceneTiming,
} from './openai-audio';
import { synthesizeWithElevenLabs, resolveElevenLabsLanguageCode, resolveElevenLabsModelForLanguage } from './elevenlabs-tts';
import { getElevenLabsSessionStatus } from './elevenlabs-auth';
import {
  assembleFinalVideo,
  assembleSlideshowFromImages,
  buildNarrationTrack,
  concatClipFiles,
  getDurationSafe,
  type NarrationTrackItem,
} from './ffmpeg';
import {
  ensureProject,
  getProject,
  getProjectDir,
  saveProjectDraft,
  updateProjectStatus,
} from './projects';
import {
  adoptSceneMedia,
  collectSceneMediaPaths,
  resolveSceneMedia,
  safeSceneKey,
  sceneMediaTarget,
} from './scene-media';

const RAW_NARRATION_FILE = 'narration-raw.mp3';
const TIMING_FILE = 'narration-timing.json';

type NarrationCache = {
  hash: string;
  audioDuration: number;
  timings: SceneTiming[];
};

type NarrationBundle = {
  audioPath: string;
  srtPath: string;
  script: ScriptDraft;
  durations: number[];
};

function emit(progress: JobProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.jobProgress, progress);
  }
}

function collectSceneMedia(
  projectDir: string,
  script: ScriptDraft,
  mediaKind: MediaKind
): string[] {
  adoptSceneMedia(projectDir, script, mediaKind);
  return collectSceneMediaPaths(projectDir, script, mediaKind);
}

function narrationHash(text: string, voice: string, model: string): string {
  return createHash('sha256').update(`${voice}|${model}|${text}`).digest('hex');
}

function readNarrationCache(projectDir: string): NarrationCache | null {
  const p = path.join(projectDir, TIMING_FILE);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as NarrationCache;
    return raw?.timings?.length ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Voiceover là MỘT mạch đọc duy nhất. Whisper cho biết mỗi narration_segment
 * chiếm đoạn nào trong mạch đó, và scene được đặt đúng bằng đoạn của mình.
 */
async function prepareNarration(options: {
  projectDir: string;
  workDir: string;
  script: ScriptDraft;
  apiKey: string;
  voice: string;
  ttsModel: string;
  language?: string;
  refresh: boolean;
  ttsProvider: 'openai' | 'elevenlabs';
  elevenLabsVoiceId?: string;
  elevenLabsModelId?: string;
}): Promise<NarrationBundle> {
  const { projectDir, workDir, apiKey, voice, ttsModel } = options;
  const scenes = options.script.scenes;
  const text = buildContinuousNarrationText(scenes);
  if (!text) throw new Error('Kịch bản chưa có lời thoại (narration_segment) để tạo voiceover.');

  const languageCode = resolveElevenLabsLanguageCode(options.language);
  const resolvedElModel =
    options.ttsProvider === 'elevenlabs'
      ? resolveElevenLabsModelForLanguage(options.elevenLabsModelId, languageCode)
      : '';
  const voiceKey =
    options.ttsProvider === 'elevenlabs'
      ? `elevenlabs:${options.elevenLabsVoiceId || ''}:${resolvedElModel}:${languageCode || ''}`
      : `openai:${voice}:${ttsModel}`;
  const hash = narrationHash(text, voiceKey, options.ttsProvider);
  const rawPath = path.join(projectDir, RAW_NARRATION_FILE);
  const audioPath = path.join(projectDir, 'narration.mp3');
  const srtPath = path.join(projectDir, 'subs.srt');

  const cache = readNarrationCache(projectDir);
  const canReuse =
    !options.refresh &&
    cache != null &&
    cache.hash === hash &&
    cache.timings.length === scenes.length &&
    fs.existsSync(rawPath) &&
    fs.statSync(rawPath).size > 0;

  let timings: SceneTiming[];
  if (canReuse && cache) {
    timings = cache.timings;
    if (!fs.existsSync(srtPath)) fs.writeFileSync(srtPath, '', 'utf8');
  } else if (options.ttsProvider === 'elevenlabs') {
    const synthesized = await synthesizeWithElevenLabs({
      text,
      voiceId: options.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM',
      modelId: options.elevenLabsModelId || 'eleven_multilingual_v2',
      language: options.language,
      outDir: projectDir,
      fileName: RAW_NARRATION_FILE,
    });
    // Keep canonical names used by the rest of the pipeline.
    if (synthesized.srtPath !== srtPath && fs.existsSync(synthesized.srtPath)) {
      fs.copyFileSync(synthesized.srtPath, srtPath);
    }
    const audioDuration = await getDurationSafe(synthesized.audioPath, 0);
    timings = computeSceneTimings({ scenes, words: synthesized.words, audioDuration });
    fs.writeFileSync(
      path.join(projectDir, TIMING_FILE),
      JSON.stringify({ hash, audioDuration, timings } satisfies NarrationCache, null, 2),
      'utf8'
    );
  } else {
    const synthesized = await synthesizeContinuousNarration({
      apiKey,
      scenes,
      voice,
      ttsModel,
      language: options.language,
      outDir: projectDir,
      fileName: RAW_NARRATION_FILE,
    });
    const audioDuration = await getDurationSafe(synthesized.audioPath, 0);
    timings = computeSceneTimings({ scenes, words: synthesized.words, audioDuration });
    fs.writeFileSync(
      path.join(projectDir, TIMING_FILE),
      JSON.stringify({ hash, audioDuration, timings } satisfies NarrationCache, null, 2),
      'utf8'
    );
  }

  const durations = scenes.map((scene, index) => {
    const timing = timings[index];
    const spoken = timing?.hasSpeech ? timing.end - timing.start : 0;
    // Scene không có lời giữ nguyên thời lượng cũ và được đệm im lặng.
    const seconds = spoken > 0 ? spoken : Math.max(1, scene.duration_hint);
    return Math.max(1, Math.round(seconds * 1000) / 1000);
  });

  const everySceneSpeaks = timings.every((t) => t.hasSpeech);
  if (everySceneSpeaks) {
    // Giữ nguyên bản đọc liền mạch, không cắt ghép để tránh sạn giữa scene.
    fs.copyFileSync(rawPath, audioPath);
  } else {
    const items: NarrationTrackItem[] = timings.map((timing, index) =>
      timing.hasSpeech
        ? { kind: 'slice', start: timing.start, end: timing.end }
        : { kind: 'silence', duration: durations[index] }
    );
    await buildNarrationTrack({
      sourcePath: rawPath,
      items,
      outputPath: audioPath,
      workDir: path.join(workDir, 'narration'),
    });
  }

  const script: ScriptDraft = {
    ...options.script,
    narration: text,
    scenes: scenes.map((scene, index) => ({ ...scene, duration_hint: durations[index] })),
  };

  return { audioPath, srtPath, script, durations };
}

function persistScript(projectId: string, script: ScriptDraft): void {
  const detail = getProject(projectId);
  if (!detail.draft) return;
  const totalSec = script.scenes.reduce((sum, scene) => sum + scene.duration_hint, 0);
  saveProjectDraft(projectId, {
    ...detail.draft,
    script,
    sceneCount: script.scenes.length,
    targetDurationSec: totalSec || detail.draft.targetDurationSec,
  });
}

export async function remuxProject(projectId: string): Promise<GenerateJobResult> {
  const detail = getProject(projectId);
  const draft = detail.draft;
  if (!draft?.script?.scenes.length) {
    throw new Error('Dự án chưa có kịch bản để ghép lại.');
  }

  const projectDir = detail.projectDir;
  const workDir = path.join(projectDir, 'work');
  const outputPath = path.join(projectDir, 'final.mp4');
  const settings = getSettings();
  const keys = getKeys();
  const mediaKind = draft.mediaKind || 'video';

  emit({ phase: 'merge', message: 'Đang ghép lại theo timeline đã chỉnh...', percent: 80 });
  updateProjectStatus(projectId, 'generating');

  try {
    let script = draft.script;
    let audioPath = path.join(projectDir, 'narration.mp3');
    let srtPath = path.join(projectDir, 'subs.srt');
    let durations = script.scenes.map((s) => Math.max(1, s.duration_hint));

    const hasRawNarration = fs.existsSync(path.join(projectDir, RAW_NARRATION_FILE));
    if (hasRawNarration) {
      emit({
        phase: 'tts',
        message: 'Đang khớp lại voiceover liền mạch với từng scene...',
        percent: 82,
      });
      const rebuilt = await prepareNarration({
        projectDir,
        workDir,
        script,
        apiKey: keys.openaiApiKey,
        voice: settings.openaiTtsVoice,
        ttsModel: settings.openaiTtsModel,
        language: draft.language,
        refresh: false,
        ttsProvider: settings.ttsProvider,
        elevenLabsVoiceId: settings.elevenLabsVoiceId,
        elevenLabsModelId: settings.elevenLabsModelId,
      });
      audioPath = rebuilt.audioPath;
      srtPath = rebuilt.srtPath;
      script = rebuilt.script;
      durations = rebuilt.durations;
      persistScript(projectId, script);
    } else if (!fs.existsSync(audioPath)) {
      throw new Error('Chưa có file narration. Hãy Generate trước.');
    }
    if (!fs.existsSync(srtPath)) {
      fs.writeFileSync(srtPath, '', 'utf8');
    }

    const mediaPaths = collectSceneMedia(projectDir, script, mediaKind);
    if (mediaKind === 'image') {
      await assembleSlideshowFromImages({
        imagePaths: mediaPaths,
        audioPath,
        srtPath,
        outputPath,
        burnSubtitles: settings.burnSubtitles,
        workDir,
        durations,
      });
    } else {
      await assembleFinalVideo({
        clipPaths: mediaPaths,
        audioPath,
        srtPath,
        outputPath,
        burnSubtitles: settings.burnSubtitles,
        workDir,
        estimatedTotalSeconds: durations.reduce((sum, d) => sum + d, 0),
        clipDurations: durations,
      });
    }

    updateProjectStatus(projectId, 'ready', { hasVideo: true, lastError: '' });
    emit({ phase: 'done', message: 'Đã áp dụng timeline!', percent: 100 });

    return {
      projectId,
      projectName: detail.meta.name,
      projectDir,
      videoPath: outputPath,
      srtPath,
      audioPath,
      title: script.title,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A failed remux must not hide a final.mp4 that is still on disk.
    const stillHasVideo = fs.existsSync(outputPath);
    updateProjectStatus(projectId, stillHasVideo ? 'ready' : 'error', {
      hasVideo: stillHasVideo,
      lastError: message,
    });
    throw err;
  }
}

export async function runGenerateJob(input: GenerateJobInput): Promise<GenerateJobResult> {
  const keys = getKeys();
  const settings = getSettings();
  const mediaKind = input.mediaKind || 'video';

  if (!keys.snapgenApiKey) throw new Error('Thiếu Snapgen API key. Vào Settings để cấu hình.');
  if (settings.ttsProvider === 'openai' && !keys.openaiApiKey) {
    throw new Error('Thiếu OpenAI API key. Vào Settings để cấu hình.');
  }
  if (settings.ttsProvider === 'elevenlabs') {
    const el = await getElevenLabsSessionStatus();
    if (!el.loggedIn) {
      throw new Error('Chưa đăng nhập ElevenLabs. Vào Settings → ElevenLabs để đăng nhập.');
    }
  }

  const meta = ensureProject({
    projectId: input.projectId || undefined,
    projectName: input.projectName,
    brief: input.brief,
    language: input.language,
    family: input.family,
    model: input.model,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    mode: input.mode,
    script: input.script,
    mediaKind,
    stylePrompt: input.stylePrompt,
  });

  const projectDir = getProjectDir(meta.id);
  const clipsDir = path.join(projectDir, 'clips');
  const imagesDir = path.join(projectDir, 'images');
  const workDir = path.join(projectDir, 'work');
  fs.mkdirSync(clipsDir, { recursive: true });
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  fs.writeFileSync(
    path.join(projectDir, 'job-input.json'),
    JSON.stringify({ ...input, projectId: meta.id, projectName: meta.name }, null, 2),
    'utf8'
  );

  try {
    const refreshNarration = input.refreshNarration !== false;
    const ttsLabel =
      settings.ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI TTS';
    emit({
      phase: 'tts',
      message: refreshNarration
        ? `Đang đọc toàn bộ kịch bản thành một mạch voiceover (${ttsLabel})...`
        : 'Giữ voiceover hiện có — khớp lại mốc từng scene.',
      percent: 4,
    });

    const narration = await prepareNarration({
      projectDir,
      workDir,
      script: input.script,
      apiKey: keys.openaiApiKey,
      voice: settings.openaiTtsVoice,
      ttsModel: settings.openaiTtsModel,
      language: input.language,
      refresh: refreshNarration,
      ttsProvider: settings.ttsProvider,
      elevenLabsVoiceId: settings.elevenLabsVoiceId,
      elevenLabsModelId: settings.elevenLabsModelId,
    });
    const audioPath = narration.audioPath;
    const srtPath = narration.srtPath;
    let script = narration.script;
    const durations = narration.durations;
    persistScript(meta.id, script);

    emit({
      phase: 'whisper',
      message:
        settings.ttsProvider === 'elevenlabs'
          ? `Đã khớp lời thoại với ${script.scenes.length} scene theo timestamp ElevenLabs.`
          : `Đã khớp lời thoại với ${script.scenes.length} scene theo timestamp Whisper.`,
      percent: 12,
    });

    const scenes = script.scenes;
    const mediaPaths: string[] = [];
    // Give legacy filenames their canonical name first so the cache below hits.
    adoptSceneMedia(projectDir, script, mediaKind);
    const cachedPaths = resolveSceneMedia(projectDir, script, mediaKind);
    const selectedIds = input.regenerateSceneIds
      ? new Set(input.regenerateSceneIds)
      : null;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const prompt = withStylePrompt(scene.visual_prompt, input.stylePrompt);
      const phase = mediaKind === 'image' ? 'image' : 'video';
      const label = mediaKind === 'image' ? 'ảnh' : 'video';
      const cachedPath = cachedPaths[i];
      const forceThis =
        Boolean(input.forceRegenerate) ||
        (selectedIds != null && selectedIds.has(scene.id));
      if (!forceThis && cachedPath) {
        emit({
          phase,
          message: `Dùng lại ${label} cảnh ${i + 1}/${scenes.length} đã tạo trước đó.`,
          sceneIndex: i,
          sceneTotal: scenes.length,
          percent: 12 + Math.round(((i + 1) / Math.max(scenes.length, 1)) * 70),
        });
        mediaPaths.push(cachedPath);
        continue;
      }

      emit({
        phase,
        message: `Đang tạo ${label} cảnh ${i + 1}/${scenes.length}...`,
        sceneIndex: i,
        sceneTotal: scenes.length,
        percent: 12 + Math.round((i / Math.max(scenes.length, 1)) * 70),
      });

      if (mediaKind === 'image') {
        const job = await generateImage({
          apiKey: keys.snapgenApiKey,
          family: input.family as ImageFamily,
          model: input.model,
          prompt,
          aspectRatio: input.aspectRatio,
          resolution: input.resolution,
          mode: input.mode,
        });

        const hist = await waitForMedia(keys.snapgenApiKey, job.uuid, 'image', (pct) => {
          emit({
            phase: 'image',
            message: `Ảnh ${i + 1}/${scenes.length}: ${pct}%`,
            sceneIndex: i,
            sceneTotal: scenes.length,
            percent: 12 + Math.round(((i + pct / 100) / Math.max(scenes.length, 1)) * 70),
          });
        });

        const url = getImageUrl(hist);
        if (!url) throw new Error(`Thiếu image_url cho scene ${i + 1}`);

        const imagePath = sceneMediaTarget(imagesDir, scene.id, 'png');
        await downloadFile(url, imagePath);
        mediaPaths.push(imagePath);
      } else {
        // Each scene starts as a NEW video (hard cut between scenes).
        // Only within a long scene do we extend the same clip.
        const desired = Math.max(1, scene.duration_hint);
        const plan = planSceneChunks(input.model, String(input.family), desired);
        const segmentDir = path.join(workDir, `scene-${safeSceneKey(scene.id)}`);
        fs.mkdirSync(segmentDir, { recursive: true });
        const segmentPaths: string[] = [];
        let refHistory: string | null = null;

        for (let c = 0; c < plan.chunks.length; c++) {
          const chunkDur = plan.chunks[c];
          const isFirst = c === 0;
          const chunkPrompt = isFirst
            ? prompt
            : plan.mode === 'extend'
              ? `Continue the same shot seamlessly, no cut, natural motion continuation. ${prompt}`
              : `New beat of the same scene, hard cut ok, keep visual continuity. ${prompt}`;

          emit({
            phase: 'video',
            message:
              plan.mode === 'extend' && !isFirst
                ? `Cảnh ${i + 1}: extend đoạn ${c + 1}/${plan.chunks.length} (${chunkDur}s)...`
                : plan.chunks.length > 1
                  ? `Cảnh ${i + 1}: gen đoạn ${c + 1}/${plan.chunks.length} (${chunkDur}s)...`
                  : `Đang tạo video cảnh ${i + 1}/${scenes.length} (${chunkDur}s)...`,
            sceneIndex: i,
            sceneTotal: scenes.length,
            percent:
              12 +
              Math.round(
                ((i + (c + 0.5) / plan.chunks.length) / Math.max(scenes.length, 1)) * 70
              ),
          });

          let histUuid: string;
          if (plan.mode === 'extend' && !isFirst && refHistory) {
            const job = await extendVideo({
              apiKey: keys.snapgenApiKey,
              family: input.family as VideoFamily,
              prompt: chunkPrompt,
              refHistory,
              duration: chunkDur,
              resolution: input.resolution,
              mode: input.mode,
            });
            histUuid = job.uuid;
          } else {
            const job = await generateVideo({
              apiKey: keys.snapgenApiKey,
              family: input.family as VideoFamily,
              model: input.model,
              prompt: chunkPrompt,
              duration: chunkDur,
              aspectRatio: input.aspectRatio,
              resolution: input.resolution,
              mode: input.mode,
            });
            histUuid = job.uuid;
          }

          const hist = await waitForMedia(keys.snapgenApiKey, histUuid, 'video', (pct) => {
            emit({
              phase: 'video',
              message: `Cảnh ${i + 1} đoạn ${c + 1}/${plan.chunks.length}: ${pct}%`,
              sceneIndex: i,
              sceneTotal: scenes.length,
              percent:
                12 +
                Math.round(
                  ((i + (c + pct / 100) / plan.chunks.length) / Math.max(scenes.length, 1)) * 70
                ),
            });
          });

          const url = hist.generated_video?.[0]?.video_url;
          if (!url) throw new Error(`Thiếu video_url cho scene ${i + 1} đoạn ${c + 1}`);
          const segPath = path.join(segmentDir, `part-${c + 1}.mp4`);
          await downloadFile(url, segPath);
          segmentPaths.push(segPath);
          refHistory = hist.uuid;
        }

        const clipPath = sceneMediaTarget(clipsDir, scene.id, 'mp4');
        await concatClipFiles(segmentPaths, clipPath, path.join(segmentDir, 'merge'));
        mediaPaths.push(clipPath);
      }
    }

    fs.writeFileSync(
      path.join(projectDir, 'scene-manifest.json'),
      JSON.stringify(
        scenes.map((scene, index) => ({
          sceneId: scene.id,
          sceneIndex: index,
          prompt: scene.visual_prompt,
          duration: scene.duration_hint,
          mediaPath: mediaPaths[index],
          mediaKind,
        })),
        null,
        2
      ),
      'utf8'
    );

    emit({
      phase: 'merge',
      message:
        mediaKind === 'image'
          ? 'Đang ghép slideshow ảnh + audio + subtitle...'
          : 'Đang cắt ghép các cảnh (hard cut) + audio + subtitle...',
      percent: 88,
    });

    const outputPath = path.join(projectDir, 'final.mp4');
    if (mediaKind === 'image') {
      await assembleSlideshowFromImages({
        imagePaths: mediaPaths,
        audioPath,
        srtPath,
        outputPath,
        burnSubtitles: input.burnSubtitles ?? settings.burnSubtitles,
        workDir,
        durations,
      });
    } else {
      await assembleFinalVideo({
        clipPaths: mediaPaths,
        audioPath,
        srtPath,
        outputPath,
        burnSubtitles: input.burnSubtitles ?? settings.burnSubtitles,
        workDir,
        estimatedTotalSeconds: durations.reduce((sum, d) => sum + d, 0),
        clipDurations: durations,
      });
    }

    updateProjectStatus(meta.id, 'ready', { hasVideo: true, lastError: '' });
    emit({ phase: 'done', message: 'Hoàn tất!', percent: 100 });

    return {
      projectId: meta.id,
      projectName: meta.name,
      projectDir,
      videoPath: outputPath,
      srtPath,
      audioPath,
      title: script.title,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateProjectStatus(meta.id, 'error', { lastError: message });
    throw err;
  }
}
