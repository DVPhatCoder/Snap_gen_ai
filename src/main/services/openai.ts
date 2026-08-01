import type { GenerateIdeaInput, SceneDraft, SceneSection, ScriptDraft } from '../../shared/types';
import {
  assertNarrationCoversTarget,
  assertScenesNarrationFillDuration,
  countSpokenWords,
  estimateScriptSpokenSeconds,
  estimateSpokenSeconds,
  familySupportsExtend,
  findScenesWithShortNarration,
  formatDurationLabel,
  maxSingleShotDuration,
  MAX_SCENE_BEAT_SEC,
  mergeUndersizedScenes,
  MIN_NARRATION_COVERAGE,
  MIN_SCENE_BEAT_SEC,
  normalizeSceneDurations,
  planScenesFromDuration,
  WORDS_PER_SECOND,
  wordsForDurationSec,
} from '../../shared/models';

/** Chunk ~75s — đủ dài cho nội dung, đủ ngắn để model viết đủ lời trong 1 response. */
const CHAPTER_CHUNK_SEC = 75;
const MAX_COMPLETION_TOKENS = 16384;

interface ChapterOutline {
  name: string;
  section: SceneSection;
  targetSec: number;
  summary: string;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1].trim() : trimmed;
  return JSON.parse(raw);
}

function normalizeSection(raw: unknown): SceneSection | undefined {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (value === 'introduction' || value === 'intro' || value === 'hook' || value === 'opening') {
    return 'introduction';
  }
  if (value === 'body' || value === 'main' || value === 'content') {
    return 'body';
  }
  if (
    value === 'conclusion' ||
    value === 'outro' ||
    value === 'ending' ||
    value === 'close' ||
    value === 'closing'
  ) {
    return 'conclusion';
  }
  return undefined;
}

function normalizeChapter(raw: unknown): string | undefined {
  const value = String(raw || '').trim();
  return value || undefined;
}

function assignSections(scenes: SceneDraft[]): SceneDraft[] {
  const n = scenes.length;
  if (n < 3) return scenes;

  const hasAll =
    scenes.some((s) => s.section === 'introduction') &&
    scenes.some((s) => s.section === 'body') &&
    scenes.some((s) => s.section === 'conclusion');
  if (hasAll) return scenes;

  return scenes.map((scene, index) => {
    if (scene.section) return scene;
    let section: SceneSection = 'body';
    if (index === 0) section = 'introduction';
    else if (index === n - 1) section = 'conclusion';
    return { ...scene, section };
  });
}

function assertScriptStructure(scenes: SceneDraft[]): void {
  const intro = scenes.filter((s) => s.section === 'introduction').length;
  const body = scenes.filter((s) => s.section === 'body').length;
  const conclusion = scenes.filter((s) => s.section === 'conclusion').length;
  if (scenes.length < 3 || intro < 1 || body < 1 || conclusion < 1) {
    throw new Error(
      'Kịch bản thiếu cấu trúc bắt buộc (Introduction / Body / Conclusion). Hãy tạo lại script.'
    );
  }
}

function reindexScenes(scenes: SceneDraft[]): SceneDraft[] {
  return scenes.map((scene, i) => ({
    ...scene,
    id: `scene-${String(i + 1).padStart(2, '0')}`,
  }));
}

function mapRawScenes(rawScenes: SceneDraft[]): SceneDraft[] {
  return rawScenes.map((s, i) => ({
    id: `scene-${String(i + 1).padStart(2, '0')}`,
    visual_prompt: s.visual_prompt || '',
    narration_segment: s.narration_segment || '',
    duration_hint: Number(s.duration_hint) || estimateSpokenSeconds(s.narration_segment || '', 6),
    section: normalizeSection((s as SceneDraft).section),
    chapter: normalizeChapter((s as SceneDraft).chapter),
  }));
}

function finalizeDraft(
  parsed: ScriptDraft,
  targetDurationSec: number,
  options?: { requireStructure?: boolean }
): ScriptDraft {
  if (!parsed.scenes?.length) throw new Error('Script JSON missing scenes.');

  let scenes = mapRawScenes(parsed.scenes);
  scenes = assignSections(scenes);
  scenes = mergeUndersizedScenes(scenes);
  scenes = reindexScenes(scenes);
  if (options?.requireStructure !== false) {
    assertScriptStructure(scenes);
  }

  const normalized = normalizeSceneDurations(scenes, targetDurationSec);
  parsed.scenes = reindexScenes(normalized);
  parsed.narration = parsed.scenes.map((s) => s.narration_segment).join(' ');
  if (!parsed.title) parsed.title = 'Untitled Video';
  return parsed;
}

function shortSceneReport(scenes: SceneDraft[]): string {
  return findScenesWithShortNarration(scenes)
    .map(({ index, scene, spoken, planned }) => {
      const needWords = wordsForDurationSec(planned);
      const haveWords = countSpokenWords(scene.narration_segment || '');
      return `- Scene ${index + 1} [${scene.chapter || scene.section || 'body'}]: ~${haveWords} words (~${Math.round(spoken)}s) but needs ~${needWords} words for ${planned}s.`;
    })
    .join('\n');
}

function longSceneReport(scenes: SceneDraft[]): string {
  return scenes
    .map((scene, index) => {
      const spoken = estimateSpokenSeconds(scene.narration_segment || '', 0);
      if (spoken <= MAX_SCENE_BEAT_SEC) return null;
      return `- Scene ${index + 1} [${scene.chapter || ''}]: ~${Math.round(spoken)}s — SPLIT into multiple scenes.`;
    })
    .filter(Boolean)
    .join('\n');
}

function needsNarrationExpansion(scenes: SceneDraft[], targetDurationSec: number): boolean {
  if (estimateScriptSpokenSeconds(scenes) < targetDurationSec * MIN_NARRATION_COVERAGE) {
    return true;
  }
  return findScenesWithShortNarration(scenes).length > 0;
}

function needsBeatSplit(scenes: SceneDraft[]): boolean {
  return scenes.some(
    (s) => estimateSpokenSeconds(s.narration_segment || '', 0) > MAX_SCENE_BEAT_SEC
  );
}

async function chatJson<T>(options: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
}): Promise<T> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      temperature: options.temperature ?? 0.7,
      max_tokens: MAX_COMPLETION_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
      ],
    }),
  });

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI error HTTP ${res.status}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty content.');
  if (data.choices?.[0]?.finish_reason === 'length') {
    throw new Error(
      'OpenAI cắt response vì quá dài (finish_reason=length). Thử model lớn hơn hoặc rút ngắn thời lượng.'
    );
  }

  return extractJson(content) as T;
}

function defaultChapterPlan(targetDurationSec: number): ChapterOutline[] {
  const introSec = Math.max(20, Math.round(targetDurationSec * 0.12));
  const outroSec = Math.max(15, Math.round(targetDurationSec * 0.1));
  const bodySec = Math.max(CHAPTER_CHUNK_SEC, targetDurationSec - introSec - outroSec);
  const bodyChunks = Math.max(1, Math.ceil(bodySec / CHAPTER_CHUNK_SEC));
  const eachBody = Math.round(bodySec / bodyChunks);

  const chapters: ChapterOutline[] = [
    {
      name: 'Opening',
      section: 'introduction',
      targetSec: introSec,
      summary: 'Hook the viewer and set up the topic.',
    },
  ];
  for (let i = 0; i < bodyChunks; i++) {
    chapters.push({
      name: `Part ${i + 1}`,
      section: 'body',
      targetSec: eachBody,
      summary: `Main content block ${i + 1} of ${bodyChunks}.`,
    });
  }
  chapters.push({
    name: 'Outro',
    section: 'conclusion',
    targetSec: outroSec,
    summary: 'Wrap up, CTA, end.',
  });

  // Fix rounding drift on last body/outro
  const sum = chapters.reduce((s, c) => s + c.targetSec, 0);
  chapters[chapters.length - 1].targetSec = Math.max(
    MIN_SCENE_BEAT_SEC * 2,
    chapters[chapters.length - 1].targetSec + (targetDurationSec - sum)
  );
  return chapters;
}

function normalizeOutline(
  raw: Array<Partial<ChapterOutline>> | undefined,
  targetDurationSec: number
): ChapterOutline[] {
  const fallback = defaultChapterPlan(targetDurationSec);
  if (!raw?.length) return fallback;

  const chapters: ChapterOutline[] = raw.map((c, i) => {
    const section =
      normalizeSection(c.section) ||
      (i === 0 ? 'introduction' : i === raw.length - 1 ? 'conclusion' : 'body');
    return {
      name: String(c.name || `Chapter ${i + 1}`).trim() || `Chapter ${i + 1}`,
      section,
      targetSec: Math.max(
        MIN_SCENE_BEAT_SEC * 2,
        Math.round(Number(c.targetSec) || CHAPTER_CHUNK_SEC)
      ),
      summary: String(c.summary || '').trim() || 'Continue the story.',
    };
  });

  if (!chapters.some((c) => c.section === 'introduction')) {
    chapters[0].section = 'introduction';
  }
  if (!chapters.some((c) => c.section === 'conclusion')) {
    chapters[chapters.length - 1].section = 'conclusion';
  }
  if (!chapters.some((c) => c.section === 'body')) {
    const mid = chapters[Math.floor(chapters.length / 2)];
    if (mid.section !== 'introduction' && mid.section !== 'conclusion') mid.section = 'body';
  }

  // Scale to exact target
  const sum = chapters.reduce((s, c) => s + c.targetSec, 0) || 1;
  const scaled = chapters.map((c) => ({
    ...c,
    targetSec: Math.max(
      MIN_SCENE_BEAT_SEC * 2,
      Math.round((c.targetSec / sum) * targetDurationSec)
    ),
  }));
  const drift =
    targetDurationSec - scaled.reduce((s, c) => s + c.targetSec, 0);
  scaled[scaled.length - 1].targetSec = Math.max(
    MIN_SCENE_BEAT_SEC * 2,
    scaled[scaled.length - 1].targetSec + drift
  );
  return scaled;
}

export async function testOpenAI(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, message: `HTTP ${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true, message: 'OpenAI API key hợp lệ.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Tạo script theo Chapter → Scene.
 * Video dài: outline trước, rồi gen từng chapter (tránh 1 response quá ngắn / bị cắt).
 */
export async function generateScript(
  apiKey: string,
  openaiModel: string,
  input: GenerateIdeaInput
): Promise<ScriptDraft> {
  const isImage = input.mediaKind === 'image';
  const plan = planScenesFromDuration(input.targetDurationSec);
  const targetDurationSec = plan.targetDurationSec;
  const maxShot =
    input.maxShotSec ?? maxSingleShotDuration(input.model) ?? plan.typicalBeatSec;
  const canExtend = !isImage && familySupportsExtend(String(input.family));
  const targetWords = plan.targetWordCount;

  const styleLine = input.stylePrompt?.trim()
    ? `- Global visual style (MUST apply to every visual_prompt): ${input.stylePrompt.trim()}`
    : '- Keep visual continuity across scenes.';

  const visualRule = isImage
    ? '- visual_prompt: one clear still composition. One idea per image.'
    : '- visual_prompt: one primary action/image per scene. Hard cut between scenes.';

  const sharedRules = `Language for narration: ${input.language}
${visualRule}
${styleLine}
- Each scene = ONE main idea OR ONE primary visual (~${MIN_SCENE_BEAT_SEC}–${MAX_SCENE_BEAT_SEC}s spoken, ideal ~${plan.typicalBeatSec}s).
- duration_hint ≈ spoken length of narration_segment (~${WORDS_PER_SECOND} words/sec).
- Narration is continuous voiceover across scenes; write full host sentences, not captions.
${isImage ? '' : `- Model max shot / extend chunk: ${maxShot}s (${canExtend ? 'extend ok' : 'multi-cut'})`}
Media: ${input.mediaKind} · ${input.family}/${input.model} · ${input.aspectRatio} · ${input.resolution}`;

  // —— Phase 1: outline chapters ——
  const outlineSystem = `You plan a ${formatDurationLabel(targetDurationSec)} video script outline.
Return ONLY JSON:
{
  "title": string,
  "chapters": [
    { "name": string, "section": "introduction"|"body"|"conclusion", "targetSec": number, "summary": string }
  ]
}
Rules:
- Sum of targetSec MUST equal ${targetDurationSec}.
- Prefer chapters of ~${CHAPTER_CHUNK_SEC}s (range 45–90s). For listicles, each list item can be its own chapter.
- Must include introduction, body (one or more), conclusion.
- Do NOT write full narration yet — only chapter plan.`;

  const outlineUser = `Brief / topic: ${input.brief}

Plan chapters for a ${targetDurationSec}s (${formatDurationLabel(targetDurationSec)}) video (~${targetWords} spoken words total).
${input.stylePrompt?.trim() ? `Style: ${input.stylePrompt.trim()}` : ''}`;

  let title = 'Untitled Video';
  let chapters: ChapterOutline[];
  try {
    const outline = await chatJson<{ title?: string; chapters?: Array<Partial<ChapterOutline>> }>({
      apiKey,
      model: openaiModel,
      system: outlineSystem,
      user: outlineUser,
      temperature: 0.6,
    });
    title = String(outline.title || '').trim() || title;
    chapters = normalizeOutline(outline.chapters, targetDurationSec);
  } catch {
    chapters = defaultChapterPlan(targetDurationSec);
  }

  // —— Phase 2: generate each chapter with full narration ——
  const chapterSystem = `You write ONE chapter of a video script as JSON scenes only.
Return ONLY JSON:
{
  "scenes": [
    {
      "id": string,
      "section": "introduction"|"body"|"conclusion",
      "chapter": string,
      "visual_prompt": string,
      "narration_segment": string,
      "duration_hint": number
    }
  ]
}

${sharedRules}
CRITICAL: This chapter alone must contain enough spoken words for its time budget.
Short captions are a FAILURE. Write complete spoken sentences.`;

  const allScenes: SceneDraft[] = [];
  const previousTail: string[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const chapterWords = wordsForDurationSec(chapter.targetSec);
    const minWords = Math.round(chapterWords * MIN_NARRATION_COVERAGE);
    const sceneHint = Math.max(
      3,
      Math.round(chapter.targetSec / plan.typicalBeatSec)
    );

    let chapterScenes: SceneDraft[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const prevContext =
        previousTail.length > 0
          ? `Previous narration tail (continue smoothly, do not repeat):\n${previousTail.slice(-2).join('\n')}`
          : 'This is the start of the video.';

      const user = `Video title: ${title}
Brief: ${input.brief}

Chapter ${i + 1}/${chapters.length}: "${chapter.name}"
section: ${chapter.section}
summary: ${chapter.summary}
TIME BUDGET for THIS chapter only: ${chapter.targetSec}s → write ~${chapterWords} spoken words (≥ ${minWords}).
Soft scene count hint: ~${sceneHint} scenes (one idea each). All scenes.chapter = "${chapter.name}". All scenes.section = "${chapter.section}".

${prevContext}

${attempt > 1 ? `RETRY #${attempt}: previous draft was too short. Expand narration and/or add more one-idea scenes until ≥ ${minWords} words.` : ''}

Return JSON with scenes for THIS chapter only.`;

      const parsed = await chatJson<{ scenes?: SceneDraft[] }>({
        apiKey,
        model: openaiModel,
        system: chapterSystem,
        user,
        temperature: 0.7,
      });

      chapterScenes = mapRawScenes(parsed.scenes || []).map((s) => ({
        ...s,
        chapter: chapter.name,
        section: chapter.section,
      }));

      if (!chapterScenes.length) continue;

      const spoken = estimateScriptSpokenSeconds(chapterScenes);
      if (spoken >= chapter.targetSec * MIN_NARRATION_COVERAGE || attempt === 3) {
        // If still short on last attempt, keep best effort — global assert later may still fail with clear message
        break;
      }
    }

    if (!chapterScenes.length) {
      throw new Error(`AI không tạo được scene cho chapter "${chapter.name}". Thử Generate lại.`);
    }

    // Local beat fix: split overlong within chapter via one rewrite if needed
    if (needsBeatSplit(chapterScenes)) {
      const longs = longSceneReport(chapterScenes);
      const splitParsed = await chatJson<{ scenes?: SceneDraft[] }>({
        apiKey,
        model: openaiModel,
        system: chapterSystem,
        user: `Chapter "${chapter.name}" (${chapter.section}), budget ${chapter.targetSec}s (~${chapterWords} words).
SPLIT these overlong beats into more one-idea scenes. Keep total speech length.
${longs}

Current scenes:
${chapterScenes.map((s, idx) => `${idx + 1}. ${s.narration_segment}`).join('\n')}

Return FULL chapter JSON scenes.`,
        temperature: 0.55,
      });
      const splitScenes = mapRawScenes(splitParsed.scenes || []);
      if (splitScenes.length) {
        chapterScenes = splitScenes.map((s) => ({
          ...s,
          chapter: chapter.name,
          section: chapter.section,
        }));
      }
    }

    allScenes.push(...chapterScenes);
    previousTail.push(
      ...chapterScenes.slice(-2).map((s) => s.narration_segment || '')
    );
  }

  let draft = finalizeDraft(
    { title, narration: '', scenes: allScenes },
    targetDurationSec
  );

  // —— Phase 3: nếu tổng vẫn thiếu → gen thêm scene cho các chapter yếu ——
  for (let attempt = 1; attempt <= 2 && needsNarrationExpansion(draft.scenes, targetDurationSec); attempt++) {
    const byChapter = new Map<string, SceneDraft[]>();
    for (const scene of draft.scenes) {
      const key = scene.chapter || scene.section || 'body';
      const list = byChapter.get(key) || [];
      list.push(scene);
      byChapter.set(key, list);
    }

    const weak = [...byChapter.entries()]
      .map(([name, scenes]) => {
        const spoken = estimateScriptSpokenSeconds(scenes);
        const planned = scenes.reduce((s, x) => s + (x.duration_hint || 0), 0);
        return { name, scenes, spoken, planned, deficit: planned - spoken };
      })
      .filter((c) => c.deficit > 8 || c.spoken < c.planned * MIN_NARRATION_COVERAGE)
      .sort((a, b) => b.deficit - a.deficit);

    if (!weak.length) break;

    const target = weak[0];
    const needWords = wordsForDurationSec(Math.max(target.planned, target.spoken + target.deficit));
    const fill = await chatJson<{ scenes?: SceneDraft[] }>({
      apiKey,
      model: openaiModel,
      system: chapterSystem,
      user: `Video title: ${title}
Brief: ${input.brief}

EXPAND chapter "${target.name}" — currently ~${Math.round(target.spoken)}s speech but needs ~${Math.round(target.planned)}s.
Write a FULL replacement scene list for this chapter with ≥ ${needWords} spoken words.
Keep section="${target.scenes[0]?.section || 'body'}", chapter="${target.name}".
Add more one-idea scenes as needed. Do not summarize.

Existing narration to improve upon:
${target.scenes.map((s, idx) => `${idx + 1}. ${s.narration_segment}`).join('\n')}`,
      temperature: 0.7,
    });

    const filled = mapRawScenes(fill.scenes || []).map((s) => ({
      ...s,
      chapter: target.name,
      section: target.scenes[0]?.section || normalizeSection(s.section) || 'body',
    }));
    if (!filled.length) continue;

    const nextScenes: SceneDraft[] = [];
    let replaced = false;
    for (const scene of draft.scenes) {
      const key = scene.chapter || scene.section || 'body';
      if (key === target.name) {
        if (!replaced) {
          nextScenes.push(...filled);
          replaced = true;
        }
        continue;
      }
      nextScenes.push(scene);
    }
    if (!replaced) nextScenes.push(...filled);

    draft = finalizeDraft({ title: draft.title, narration: '', scenes: nextScenes }, targetDurationSec);
  }

  assertNarrationCoversTarget(draft.scenes, targetDurationSec, MIN_NARRATION_COVERAGE);
  assertScenesNarrationFillDuration(draft.scenes, MIN_NARRATION_COVERAGE);
  return draft;
}

/**
 * Sau khi đo audio TTS lệch mục tiêu: AI rewrite narration rồi TTS lại.
 */
export async function rewriteNarrationToMatchDuration(options: {
  apiKey: string;
  openaiModel: string;
  script: ScriptDraft;
  language: string;
  targetDurationSec: number;
  actualAudioSec: number;
}): Promise<ScriptDraft> {
  const { apiKey, openaiModel, script, language, targetDurationSec, actualAudioSec } = options;
  const target = Math.max(1, targetDurationSec);
  const actual = Math.max(0.1, actualAudioSec);
  const ratio = target / actual;
  const tooShort = actual < target;

  const system = `You adjust voiceover length to match a measured TTS runtime.
Return ONLY valid JSON with scenes including section, chapter, visual_prompt, narration_segment, duration_hint.

Rules:
- Language: ${language}
- Prefer keeping the same chapters and scene ideas; you MAY split/merge slightly if needed for ${MIN_SCENE_BEAT_SEC}–${MAX_SCENE_BEAT_SEC}s beats.
- Scale spoken length ≈ ${ratio.toFixed(3)}× (${tooShort ? 'EXPAND' : 'COMPRESS'}).
- Narration must naturally fill each scene duration (~${WORDS_PER_SECOND} words/sec).
- One idea / one visual per scene. Continuous voiceover across scenes.`;

  const sceneLines = script.scenes
    .map((s, i) => {
      const planned = Math.max(2, s.duration_hint || 6);
      return `Scene ${i + 1} [${s.id}] chapter=${s.chapter || '—'} section=${s.section || 'body'} duration_hint=${planned}s\nvisual: ${s.visual_prompt}\nnarration: ${s.narration_segment}`;
    })
    .join('\n\n');

  const rewritten = await chatJson<ScriptDraft>({
    apiKey,
    model: openaiModel,
    system,
    user: `Target voiceover: ${target}s (${formatDurationLabel(target)})
Measured TTS audio: ${actual.toFixed(2)}s (${formatDurationLabel(actual)})
Relative error: ${(((actual - target) / target) * 100).toFixed(1)}%
Action: ${tooShort ? 'LENGTHEN' : 'SHORTEN'} narration so a new TTS pass lands within ±3% of ${target}s.

Title: ${script.title}
${sceneLines}

Return the FULL rewritten JSON.`,
    temperature: 0.55,
  });

  return finalizeDraft(rewritten, target);
}
