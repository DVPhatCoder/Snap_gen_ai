import type { GenerateIdeaInput, SceneDraft, SceneSection, ScriptDraft } from '../../shared/types';
import {
  assertNarrationCoversTarget,
  assertScenesNarrationFillDuration,
  countSpokenWords,
  estimateScriptSpokenSeconds,
  familySupportsExtend,
  findScenesWithShortNarration,
  formatDurationLabel,
  maxSingleShotDuration,
  MIN_NARRATION_COVERAGE,
  normalizeSceneDurations,
  planScenesFromDuration,
  WORDS_PER_SECOND,
  wordsForDurationSec,
} from '../../shared/models';

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

function finalizeDraft(
  parsed: ScriptDraft,
  targetDurationSec: number
): ScriptDraft {
  if (!parsed.scenes?.length) throw new Error('Script JSON missing scenes.');

  const normalized = normalizeSceneDurations(parsed.scenes, targetDurationSec);
  let scenes: SceneDraft[] = normalized.map((s, i) => ({
    id: `scene-${String(i + 1).padStart(2, '0')}`,
    visual_prompt: s.visual_prompt || '',
    narration_segment: s.narration_segment || '',
    duration_hint: s.duration_hint,
    section: normalizeSection((s as SceneDraft).section),
  }));

  scenes = assignSections(scenes);
  assertScriptStructure(scenes);
  parsed.scenes = scenes;
  parsed.narration =
    parsed.narration || parsed.scenes.map((s) => s.narration_segment).join(' ');
  if (!parsed.title) parsed.title = 'Untitled Video';
  return parsed;
}

function shortSceneReport(scenes: SceneDraft[]): string {
  return findScenesWithShortNarration(scenes)
    .map(({ index, scene, spoken, planned }) => {
      const needWords = wordsForDurationSec(planned);
      const haveWords = countSpokenWords(scene.narration_segment || '');
      return `- Scene ${index + 1} (${scene.id}, ${scene.section || 'body'}): ~${haveWords} words (~${Math.round(spoken)}s spoken) but duration_hint=${planned}s needs ~${needWords} words. Expand this narration_segment so it naturally fills the full ${planned}s when read aloud.`;
    })
    .join('\n');
}

function needsNarrationExpansion(scenes: SceneDraft[], targetDurationSec: number): boolean {
  if (estimateScriptSpokenSeconds(scenes) < targetDurationSec * MIN_NARRATION_COVERAGE) {
    return true;
  }
  return findScenesWithShortNarration(scenes).length > 0;
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
 * Tạo script: số scene từ thời lượng ÷ beat, narration đủ dài khớp target,
 * tự expand nếu còn thiếu trước khi trả về UI / TTS.
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
  const sceneCount = Math.max(
    3,
    input.sceneCount && input.sceneCount > 0 ? input.sceneCount : plan.sceneCountHint
  );
  const secondsPerScene = plan.secondsPerScene;
  const wordsPerScene = wordsForDurationSec(secondsPerScene);
  const targetWords = plan.targetWordCount;

  const styleLine = input.stylePrompt?.trim()
    ? `- Global visual style (MUST apply to every visual_prompt for consistency): ${input.stylePrompt.trim()}`
    : '- Keep visual continuity and a consistent look across scenes.';

  const visualRule = isImage
    ? '- visual_prompt must be detailed English suitable for text-to-image AI (composition, lighting, subject, camera angle). Do NOT describe motion or camera moves over time.'
    : '- visual_prompt must be detailed cinematic English suitable for text-to-video AI (camera, lighting, motion). Each scene is a SEPARATE shot with a hard cut — do NOT write as one continuous take across scenes.';

  const system = `You are a professional AI ${isImage ? 'art director' : 'video director'} and screenwriter.
Return ONLY valid JSON (no markdown) with this exact shape:
{
  "title": string,
  "narration": string,
  "scenes": [
    {
      "id": string,
      "section": "introduction" | "body" | "conclusion",
      "visual_prompt": string,
      "narration_segment": string,
      "duration_hint": number
    }
  ]
}

MANDATORY STRUCTURE: introduction scene(s) → body scene(s) → conclusion scene(s).
Every scene MUST include "section".

DURATION / NARRATION CONTRACT (non-negotiable):
- Create EXACTLY ${sceneCount} scenes (not fewer).
- Target total runtime: ${targetDurationSec}s (${formatDurationLabel(targetDurationSec)}).
- Each scene duration_hint ≈ ${secondsPerScene}s (may vary ±30% but SUM must ≈ ${targetDurationSec}s).
- CRITICAL: Narration must naturally fill the target duration of each scene.
  For a scene with duration_hint=T seconds, write a narration_segment that takes ≈T seconds to speak (~${WORDS_PER_SECOND} words per second × T).
  Do NOT leave dead air. Do NOT cover a long scene with one short sentence.
- Speech pace ≈ 2.5 words/second. Each narration_segment for a ${secondsPerScene}s scene needs ≈${wordsPerScene} words.
- TOTAL words across all narration_segments MUST be ≈${targetWords} words (≥ ${Math.round(targetWords * MIN_NARRATION_COVERAGE)}).
- Final video length FOLLOWS the voiceover. Short 2–3 minute scripts for a ${formatDurationLabel(targetDurationSec)} target are REJECTED.
- Language for narration: ${input.language}
${visualRule}
${styleLine}
- narration_segments form ONE continuous voiceover (no restarts / repeated intros between scenes).
- Expand body with real detail from the brief — do not use empty filler phrases.`;

  const userBase = `Brief / topic: ${input.brief}

Build a full Intro → Body → Conclusion script.
Required scenes: EXACTLY ${sceneCount}
Required total duration: ${targetDurationSec}s (${formatDurationLabel(targetDurationSec)})
Required total narration: ~${targetWords} words
Average per scene: ~${secondsPerScene}s / ~${wordsPerScene} words
${isImage ? '' : `Model max shot / extend chunk: ${maxShot}s (${canExtend ? 'extend supported' : 'multi-cut if longer'})`}
Media: ${input.mediaKind}
Model: ${input.family}/${input.model}
Aspect ratio: ${input.aspectRatio}
Resolution: ${input.resolution}
${input.stylePrompt?.trim() ? `Style guide: ${input.stylePrompt.trim()}` : ''}`;

  const callModel = async (userContent: string): Promise<ScriptDraft> => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: openaiModel,
        temperature: 0.65,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      }),
    });

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!res.ok) {
      throw new Error(data.error?.message || `OpenAI error HTTP ${res.status}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned empty content.');

    return finalizeDraft(extractJson(content) as ScriptDraft, targetDurationSec);
  };

  let draft = await callModel(userBase);

  // Expand until mỗi scene fill duration_hint AND tổng đủ target — tối đa 3 lần.
  for (let attempt = 1; attempt <= 3 && needsNarrationExpansion(draft.scenes, targetDurationSec); attempt++) {
    const spoken = estimateScriptSpokenSeconds(draft.scenes);
    const gaps = shortSceneReport(draft.scenes);
    const shortCount = findScenesWithShortNarration(draft.scenes).length;
    draft = await callModel(
      `${userBase}

REVISION #${attempt} — NARRATION MUST NATURALLY FILL EACH SCENE DURATION
Current total spoken estimate: ~${Math.round(spoken)}s (${formatDurationLabel(spoken)})
Required total: ≥ ${Math.round(targetDurationSec * MIN_NARRATION_COVERAGE)}s (target ${targetDurationSec}s)
Scenes still too short: ${shortCount}
Keep EXACTLY ${sceneCount} scenes, Intro/Body/Conclusion, same visual continuity.
For EVERY short scene below, expand narration_segment so reading aloud fills that scene's duration_hint (no dead air, no one-liner for a long beat):
${gaps || '- Lengthen all narration_segments proportionally.'}

Return the FULL rewritten JSON script.`
    );
  }

  assertNarrationCoversTarget(draft.scenes, targetDurationSec, MIN_NARRATION_COVERAGE);
  assertScenesNarrationFillDuration(draft.scenes, MIN_NARRATION_COVERAGE);
  return draft;
}

/**
 * Sau khi đo audio TTS thực tế lệch mục tiêu: AI rewrite narration
 * (dài hơn / ngắn hơn theo tỉ lệ) rồi pipeline TTS lại.
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
  const sceneCount = script.scenes.length;

  const system = `You are a professional screenwriter adjusting voiceover length to match a target runtime.
Return ONLY valid JSON (no markdown) with the same shape:
{
  "title": string,
  "narration": string,
  "scenes": [ { "id", "section", "visual_prompt", "narration_segment", "duration_hint" } ]
}

Rules:
- Keep the SAME number of scenes (${sceneCount}), same order, same sections, same visual_prompt ideas.
- Language: ${language}
- Narration must naturally fill each scene's duration_hint when read aloud (~${WORDS_PER_SECOND} words/sec).
- Scale spoken length by approximately ${ratio.toFixed(3)}× (${tooShort ? 'EXPAND' : 'COMPRESS'}).
- Keep one continuous voiceover flow across scenes.
- Do not invent a new topic; deepen or tighten the existing content.`;

  const sceneLines = script.scenes
    .map((s, i) => {
      const planned = Math.max(2, s.duration_hint || 8);
      return `Scene ${i + 1} [${s.id}] section=${s.section || 'body'} duration_hint=${planned}s need≈${wordsForDurationSec(planned)} words\nvisual: ${s.visual_prompt}\nnarration: ${s.narration_segment}`;
    })
    .join('\n\n');

  const user = `Target voiceover duration: ${target}s (${formatDurationLabel(target)})
Measured TTS audio duration: ${actual.toFixed(2)}s (${formatDurationLabel(actual)})
Relative error: ${(((actual - target) / target) * 100).toFixed(1)}%
Action: ${tooShort ? 'LENGTHEN' : 'SHORTEN'} all narration_segments so a new TTS pass lands within ±3% of ${target}s.

Current script:
Title: ${script.title}
${sceneLines}

Return the FULL rewritten JSON.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: openaiModel,
      temperature: 0.55,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI rewrite error HTTP ${res.status}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI rewrite returned empty content.');

  const parsed = finalizeDraft(extractJson(content) as ScriptDraft, target);
  // Giữ số scene ổn định — nếu model bỏ bớt, fail rõ.
  if (parsed.scenes.length !== sceneCount) {
    throw new Error(
      `Rewrite narration đổi số scene (${parsed.scenes.length} ≠ ${sceneCount}). Thử Generate lại.`
    );
  }
  return parsed;
}
