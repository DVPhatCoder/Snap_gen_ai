import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc';
import {
  assertNarrationCoversTarget,
  assertScenesNarrationFillDuration,
  AUDIO_DURATION_TOLERANCE,
  estimateScriptSpokenSeconds,
  formatDurationLabel,
  MAX_TTS_FIT_ATTEMPTS,
  planSceneChunks,
  withStylePrompt,
} from '../../shared/models';
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
import { resolveProjectChatModel, resolveProjectVoice } from '../../shared/voice';
import { rewriteNarrationToMatchDuration } from './openai';
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
  isNanoBananaModel,
  stripNanoBananaWatermark,
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
import { setActiveJobProgress, updateActiveJobMeta } from '../job-state';

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
  /** Độ dài file TTS thô (trước khi đệm im lặng), giây. */
  rawAudioDuration: number;
};

function emit(progress: JobProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.jobProgress, progress);
  }
}

/** Keep overall % monotonic within one job so the bar never jumps backward. */
let lastOverallPercent = 0;

function resetJobProgress(): void {
  lastOverallPercent = 0;
}

function emitProgress(progress: JobProgress): void {
  const raw = progress.percent ?? lastOverallPercent;
  const percent = Math.min(100, Math.max(lastOverallPercent, Math.round(raw)));
  lastOverallPercent = percent;
  const next = { ...progress, percent };
  setActiveJobProgress(next);
  emit(next);
}

/** Snapgen sometimes returns 0–1; normalize to 0–100. */
function normalizeSnapgenPercent(raw?: number): number {
  if (raw == null || Number.isNaN(raw)) return 0;
  if (raw > 0 && raw <= 1) return Math.round(raw * 100);
  return Math.min(100, Math.max(0, Math.round(raw)));
}

/** Media generation spans 12% → 90% of the overall bar. */
function mediaOverallPercent(
  sceneIndex: number,
  sceneTotal: number,
  sceneLocal01: number
): number {
  const n = Math.max(sceneTotal, 1);
  const local = Math.min(1, Math.max(0, sceneLocal01));
  return 12 + Math.round(((sceneIndex + local) / n) * 78);
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
 * Voiceover là MỘT mạch đọc duy nhất. Whisper/ElevenLabs timestamps
 * cho biết mỗi narration_segment chiếm đoạn nào.
 * @param syncToSpeech khi true (vòng fit duration): duration = đoạn nói thật, không đệm silence.
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
  /** Khớp video theo độ dài speech thật (sau khi audio đã đạt ±3% mục tiêu). */
  syncToSpeech?: boolean;
}): Promise<NarrationBundle> {
  const { projectDir, workDir, apiKey, voice, ttsModel } = options;
  const syncToSpeech = Boolean(options.syncToSpeech);
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
  let rawAudioDuration = 0;
  if (canReuse && cache) {
    timings = cache.timings;
    rawAudioDuration = cache.audioDuration || (await getDurationSafe(rawPath, 0));
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
    if (synthesized.srtPath !== srtPath && fs.existsSync(synthesized.srtPath)) {
      fs.copyFileSync(synthesized.srtPath, srtPath);
    }
    rawAudioDuration = await getDurationSafe(synthesized.audioPath, 0);
    timings = computeSceneTimings({ scenes, words: synthesized.words, audioDuration: rawAudioDuration });
    fs.writeFileSync(
      path.join(projectDir, TIMING_FILE),
      JSON.stringify({ hash, audioDuration: rawAudioDuration, timings } satisfies NarrationCache, null, 2),
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
    rawAudioDuration = await getDurationSafe(synthesized.audioPath, 0);
    timings = computeSceneTimings({ scenes, words: synthesized.words, audioDuration: rawAudioDuration });
    fs.writeFileSync(
      path.join(projectDir, TIMING_FILE),
      JSON.stringify({ hash, audioDuration: rawAudioDuration, timings } satisfies NarrationCache, null, 2),
      'utf8'
    );
  }

  const durations = scenes.map((scene, index) => {
    const timing = timings[index];
    const spoken = timing?.hasSpeech ? timing.end - timing.start : 0;
    const planned = Math.max(1, scene.duration_hint);
    if (syncToSpeech) {
      // Audio đã đạt mục tiêu → video theo speech thật, không đệm silence dài.
      return Math.max(1, Math.round((spoken > 0 ? spoken : planned) * 1000) / 1000);
    }
    const seconds = Math.max(planned, spoken > 0 ? spoken : 0);
    return Math.max(1, Math.round(seconds * 1000) / 1000);
  });

  if (syncToSpeech) {
    fs.copyFileSync(rawPath, audioPath);
  } else {
    const items: NarrationTrackItem[] = [];
    let needsRebuild = false;
    for (let index = 0; index < timings.length; index++) {
      const timing = timings[index];
      const planned = durations[index];
      const spoken = timing.hasSpeech ? Math.max(0, timing.end - timing.start) : 0;
      if (timing.hasSpeech) {
        items.push({ kind: 'slice', start: timing.start, end: timing.end });
        const pad = planned - spoken;
        if (pad > 0.12) {
          items.push({ kind: 'silence', duration: pad });
          needsRebuild = true;
        }
      } else {
        items.push({ kind: 'silence', duration: planned });
        needsRebuild = true;
      }
    }

    const everySceneSpeaks = timings.every((t) => t.hasSpeech);
    if (everySceneSpeaks && !needsRebuild) {
      fs.copyFileSync(rawPath, audioPath);
    } else {
      await buildNarrationTrack({
        sourcePath: rawPath,
        items,
        outputPath: audioPath,
        workDir: path.join(workDir, 'narration'),
      });
    }
  }

  const script: ScriptDraft = {
    ...options.script,
    narration: text,
    scenes: scenes.map((scene, index) => ({ ...scene, duration_hint: durations[index] })),
  };

  return { audioPath, srtPath, script, durations, rawAudioDuration };
}

/**
 * GPT estimate → TTS → đo audio → lệch >3% → AI rewrite → TTS lại
 * → chỉ khi đạt mới trả bundle để render video.
 */
async function prepareNarrationFittingTarget(options: {
  projectDir: string;
  workDir: string;
  script: ScriptDraft;
  apiKey: string;
  openaiModel: string;
  voice: string;
  ttsModel: string;
  language?: string;
  ttsProvider: 'openai' | 'elevenlabs';
  elevenLabsVoiceId?: string;
  elevenLabsModelId?: string;
  targetDurationSec: number;
}): Promise<NarrationBundle> {
  const target = Math.max(1, options.targetDurationSec);
  let script = options.script;
  let lastRaw = 0;
  let lastErr = 1;

  for (let attempt = 1; attempt <= MAX_TTS_FIT_ATTEMPTS; attempt++) {
    const est = estimateScriptSpokenSeconds(script.scenes);
    const ttsLabel = options.ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI TTS';
    emitProgress({
      phase: 'tts',
      message: `TTS lần ${attempt}/${MAX_TTS_FIT_ATTEMPTS} (${ttsLabel}): ước lượng ~${formatDurationLabel(est)} → mục tiêu ${formatDurationLabel(target)}...`,
      percent: Math.min(10, 3 + attempt),
    });

    // Giữ duration_hint mục tiêu trên script khi TTS (đừng syncToSpeech giữa vòng — cần đo raw).
    const forTts: ScriptDraft = {
      ...script,
      scenes: script.scenes.map((s) => ({ ...s })),
    };

    const bundle = await prepareNarration({
      projectDir: options.projectDir,
      workDir: options.workDir,
      script: forTts,
      apiKey: options.apiKey,
      voice: options.voice,
      ttsModel: options.ttsModel,
      language: options.language,
      refresh: true,
      ttsProvider: options.ttsProvider,
      elevenLabsVoiceId: options.elevenLabsVoiceId,
      elevenLabsModelId: options.elevenLabsModelId,
      syncToSpeech: false,
    });

    const raw = bundle.rawAudioDuration;
    lastRaw = raw;
    const relErr = Math.abs(raw - target) / target;
    lastErr = relErr;

    emitProgress({
      phase: 'tts',
      message: `Đã đo audio: ${formatDurationLabel(raw)} · mục tiêu ${formatDurationLabel(target)} · lệch ${(relErr * 100).toFixed(1)}%`,
      percent: Math.min(11, 4 + attempt),
    });

    if (relErr <= AUDIO_DURATION_TOLERANCE) {
      // Đạt mục tiêu → gắn duration theo speech thật, dùng raw làm narration cuối.
      const fitted = await prepareNarration({
        projectDir: options.projectDir,
        workDir: options.workDir,
        script: {
          ...script,
          // Giữ lời vừa TTS; duration_hint sẽ lấy từ speech trong syncToSpeech.
          scenes: script.scenes.map((s, i) => ({
            ...s,
            narration_segment: forTts.scenes[i]?.narration_segment ?? s.narration_segment,
          })),
        },
        apiKey: options.apiKey,
        voice: options.voice,
        ttsModel: options.ttsModel,
        language: options.language,
        refresh: false, // reuse raw vừa tạo
        ttsProvider: options.ttsProvider,
        elevenLabsVoiceId: options.elevenLabsVoiceId,
        elevenLabsModelId: options.elevenLabsModelId,
        syncToSpeech: true,
      });
      emitProgress({
        phase: 'whisper',
        message: `Voiceover đạt mục tiêu (±${(AUDIO_DURATION_TOLERANCE * 100).toFixed(0)}%) sau ${attempt} lần TTS — bắt đầu render video.`,
        percent: 12,
      });
      return fitted;
    }

    if (attempt >= MAX_TTS_FIT_ATTEMPTS) break;

    emitProgress({
      phase: 'tts',
      message: `Lệch >${(AUDIO_DURATION_TOLERANCE * 100).toFixed(0)}% — AI đang rewrite narration rồi TTS lại...`,
      percent: Math.min(11, 5 + attempt),
    });

    script = await rewriteNarrationToMatchDuration({
      apiKey: options.apiKey,
      openaiModel: options.openaiModel,
      script,
      language: options.language || 'Tiếng Việt',
      targetDurationSec: target,
      actualAudioSec: raw,
    });
  }

  throw new Error(
    `Voiceover chưa khớp mục tiêu sau ${MAX_TTS_FIT_ATTEMPTS} lần TTS ` +
      `(audio ~${formatDurationLabel(lastRaw)}, mục tiêu ${formatDurationLabel(target)}, lệch ${(lastErr * 100).toFixed(1)}%). ` +
      `Hãy Generate script lại hoặc chỉnh brief.`
  );
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

  resetJobProgress();

  const projectDir = detail.projectDir;
  const workDir = path.join(projectDir, 'work');
  const outputPath = path.join(projectDir, 'final.mp4');
  const settings = getSettings();
  const keys = getKeys();
  const mediaKind = draft.mediaKind || 'video';
  const voice = resolveProjectVoice(draft, settings);

  emitProgress({ phase: 'merge', message: 'Đang ghép lại theo timeline đã chỉnh...', percent: 80 });
  updateProjectStatus(projectId, 'generating');

  try {
    let script = draft.script;
    let audioPath = path.join(projectDir, 'narration.mp3');
    let srtPath = path.join(projectDir, 'subs.srt');
    let durations = script.scenes.map((s) => Math.max(1, s.duration_hint));

    const hasRawNarration = fs.existsSync(path.join(projectDir, RAW_NARRATION_FILE));
    if (hasRawNarration) {
      emitProgress({
        phase: 'tts',
        message: 'Đang khớp lại voiceover liền mạch với từng scene...',
        percent: 82,
      });
      const rebuilt = await prepareNarration({
        projectDir,
        workDir,
        script,
        apiKey: keys.openaiApiKey,
        voice: voice.openaiTtsVoice,
        ttsModel: voice.openaiTtsModel,
        language: draft.language,
        refresh: false,
        ttsProvider: voice.ttsProvider,
        elevenLabsVoiceId: voice.elevenLabsVoiceId,
        elevenLabsModelId: voice.elevenLabsModelId,
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
        stripCornerLogo: isNanoBananaModel(draft.model || detail.meta.model || ''),
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
    emitProgress({ phase: 'done', message: 'Đã áp dụng timeline!', percent: 100 });

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
  const voice = resolveProjectVoice(input, settings);

  if (!keys.snapgenApiKey) throw new Error('Thiếu Snapgen API key. Vào Settings để cấu hình.');
  if (voice.ttsProvider === 'openai' && !keys.openaiApiKey) {
    throw new Error('Thiếu OpenAI API key. Vào Settings để cấu hình.');
  }
  if (voice.ttsProvider === 'elevenlabs') {
    const el = await getElevenLabsSessionStatus();
    if (!el.loggedIn && !el.hasApiCredential) {
      throw new Error('Chưa có API key ElevenLabs. Vào Settings → dán API key free rồi Lưu.');
    }
  }

  resetJobProgress();

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
  updateActiveJobMeta({ projectId: meta.id, projectName: meta.name });

  // Ghi voice theo dự án (GenerateJobInput ưu tiên).
  {
    const detail = getProject(meta.id);
    if (detail.draft) {
      saveProjectDraft(meta.id, {
        ...detail.draft,
        ...voice,
        script: input.script,
      });
    }
  }

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
    const draftTarget = getProject(meta.id).draft?.targetDurationSec;
    const hintSum = input.script.scenes.reduce(
      (sum, s) => sum + Math.max(0, s.duration_hint || 0),
      0
    );
    const spokenEst = estimateScriptSpokenSeconds(input.script.scenes);
    const targetRuntimeSec = Math.max(
      1,
      Math.round(draftTarget || hintSum || spokenEst)
    );

    // Chỉ vào vòng TTS khi narration ước lượng đủ dài (tránh TTS phí với script quá ngắn).
    if (refreshNarration) {
      assertNarrationCoversTarget(input.script.scenes, targetRuntimeSec);
      assertScenesNarrationFillDuration(input.script.scenes);
    }

    const ttsLabel = voice.ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI TTS';
    emitProgress({
      phase: 'tts',
      message: refreshNarration
        ? `Bắt đầu vòng TTS fit duration (${ttsLabel}): ước lượng ~${formatDurationLabel(spokenEst)} → mục tiêu ${formatDurationLabel(targetRuntimeSec)}`
        : 'Giữ voiceover hiện có — khớp lại mốc từng scene.',
      percent: 3,
    });

    const narration = refreshNarration
      ? await prepareNarrationFittingTarget({
          projectDir,
          workDir,
          script: input.script,
          apiKey: keys.openaiApiKey,
          openaiModel: resolveProjectChatModel(
            getProject(meta.id).draft?.openaiChatModel,
            settings.openaiModel
          ),
          voice: voice.openaiTtsVoice,
          ttsModel: voice.openaiTtsModel,
          language: input.language,
          ttsProvider: voice.ttsProvider,
          elevenLabsVoiceId: voice.elevenLabsVoiceId,
          elevenLabsModelId: voice.elevenLabsModelId,
          targetDurationSec: targetRuntimeSec,
        })
      : await prepareNarration({
          projectDir,
          workDir,
          script: input.script,
          apiKey: keys.openaiApiKey,
          voice: voice.openaiTtsVoice,
          ttsModel: voice.openaiTtsModel,
          language: input.language,
          refresh: false,
          ttsProvider: voice.ttsProvider,
          elevenLabsVoiceId: voice.elevenLabsVoiceId,
          elevenLabsModelId: voice.elevenLabsModelId,
          syncToSpeech: true,
        });
    const audioPath = narration.audioPath;
    const srtPath = narration.srtPath;
    let script = narration.script;
    const durations = narration.durations;
    persistScript(meta.id, script);

    emitProgress({
      phase: 'whisper',
      message:
        `Voiceover ${formatDurationLabel(narration.rawAudioDuration)} (mục tiêu ${formatDurationLabel(targetRuntimeSec)}) — ` +
        (voice.ttsProvider === 'elevenlabs'
          ? `khớp ${script.scenes.length} scene theo timestamp ElevenLabs.`
          : `khớp ${script.scenes.length} scene theo timestamp Whisper.`),
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
        emitProgress({
          phase,
          message: `Dùng lại ${label} cảnh ${i + 1}/${scenes.length} đã tạo trước đó.`,
          sceneIndex: i,
          sceneTotal: scenes.length,
          percent: mediaOverallPercent(i, scenes.length, 1),
        });
        mediaPaths.push(cachedPath);
        continue;
      }

      emitProgress({
        phase,
        message: `Đang tạo ${label} cảnh ${i + 1}/${scenes.length}...`,
        sceneIndex: i,
        sceneTotal: scenes.length,
        detailPercent: 0,
        percent: mediaOverallPercent(i, scenes.length, 0),
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
          const shot = normalizeSnapgenPercent(pct);
          emitProgress({
            phase: 'image',
            message: `Đang render ảnh cảnh ${i + 1}/${scenes.length}`,
            sceneIndex: i,
            sceneTotal: scenes.length,
            detailPercent: shot,
            percent: mediaOverallPercent(i, scenes.length, shot / 100),
          });
        });

        const url = getImageUrl(hist);
        if (!url) throw new Error(`Thiếu image_url cho scene ${i + 1}`);

        const imagePath = sceneMediaTarget(imagesDir, scene.id, 'png');
        await downloadFile(url, imagePath);
        if (isNanoBananaModel(input.model)) {
          await stripNanoBananaWatermark(imagePath);
        }
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

          const chunkBase = c / plan.chunks.length;
          emitProgress({
            phase: 'video',
            message:
              plan.mode === 'extend' && !isFirst
                ? `Cảnh ${i + 1}/${scenes.length}: extend đoạn ${c + 1}/${plan.chunks.length} (${chunkDur}s)`
                : plan.chunks.length > 1
                  ? `Cảnh ${i + 1}/${scenes.length}: gen đoạn ${c + 1}/${plan.chunks.length} (${chunkDur}s)`
                  : `Đang tạo video cảnh ${i + 1}/${scenes.length} (${chunkDur}s)`,
            sceneIndex: i,
            sceneTotal: scenes.length,
            chunkIndex: c,
            chunkTotal: plan.chunks.length,
            detailPercent: 0,
            percent: mediaOverallPercent(i, scenes.length, chunkBase),
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
            const shot = normalizeSnapgenPercent(pct);
            const withinScene = (c + shot / 100) / plan.chunks.length;
            emitProgress({
              phase: 'video',
              message:
                plan.chunks.length > 1
                  ? `Cảnh ${i + 1}/${scenes.length} · đoạn ${c + 1}/${plan.chunks.length}`
                  : `Đang render video cảnh ${i + 1}/${scenes.length}`,
              sceneIndex: i,
              sceneTotal: scenes.length,
              chunkIndex: c,
              chunkTotal: plan.chunks.length,
              detailPercent: shot,
              percent: mediaOverallPercent(i, scenes.length, withinScene),
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
        emitProgress({
          phase: 'video',
          message: `Xong video cảnh ${i + 1}/${scenes.length}`,
          sceneIndex: i,
          sceneTotal: scenes.length,
          detailPercent: 100,
          percent: mediaOverallPercent(i, scenes.length, 1),
        });
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

    emitProgress({
      phase: 'merge',
      message:
        mediaKind === 'image'
          ? 'Đang ghép slideshow ảnh + audio + subtitle...'
          : 'Đang cắt ghép các cảnh (hard cut) + audio + subtitle...',
      percent: 92,
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
        stripCornerLogo: isNanoBananaModel(input.model),
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
    emitProgress({ phase: 'done', message: 'Hoàn tất!', percent: 100 });

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
    const stillHasVideo = fs.existsSync(path.join(projectDir, 'final.mp4'));
    updateProjectStatus(meta.id, stillHasVideo ? 'ready' : 'error', {
      hasVideo: stillHasVideo,
      lastError: stillHasVideo ? '' : message,
    });
    throw err;
  }
}
