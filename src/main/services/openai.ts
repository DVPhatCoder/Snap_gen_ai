import type { GenerateIdeaInput, SceneDraft, SceneSection, ScriptDraft } from '../../shared/types';
import {
  familySupportsExtend,
  maxSingleShotDuration,
  normalizeSceneDurations,
  planScenesFromDuration,
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

/** Nếu model quên gắn section, suy ra theo vị trí: đầu / giữa / cuối. */
function assignSections(scenes: SceneDraft[]): SceneDraft[] {
  const n = scenes.length;
  if (n < 3) return scenes;

  const hasAll =
    scenes.some((s) => s.section === 'introduction') &&
    scenes.some((s) => s.section === 'body') &&
    scenes.some((s) => s.section === 'conclusion');
  if (hasAll) return scenes;

  // 1 scene intro, 1 scene conclusion, phần còn lại body.
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
  // Ít nhất 3 scene để đủ Intro + Body + Conclusion.
  const sceneCountHint = Math.max(
    3,
    input.sceneCount && input.sceneCount > 0 ? input.sceneCount : plan.sceneCountHint
  );
  const sceneCountMin = Math.max(3, plan.sceneCountMin);

  const styleLine = input.stylePrompt?.trim()
    ? `- Global visual style (MUST apply to every visual_prompt for consistency): ${input.stylePrompt.trim()}`
    : '- Keep visual continuity and a consistent look across scenes.';

  const visualRule = isImage
    ? '- visual_prompt must be detailed English suitable for text-to-image AI (composition, lighting, subject, camera angle). Do NOT describe motion or camera moves over time.'
    : '- visual_prompt must be detailed cinematic English suitable for text-to-video AI (camera, lighting, motion). Each scene is a SEPARATE shot with a hard cut — do NOT write as one continuous take across scenes.';

  const durationRules = isImage
    ? `- Create about ${sceneCountHint} scenes (allowed range ${sceneCountMin}-${plan.sceneCountMax}, MINIMUM 3).
- duration_hint is the slide / narration window for that scene in seconds.
- Vary duration_hint by content; denser narration → longer duration_hint.
- Sum of all duration_hint must be approximately ${targetDurationSec} seconds.`
    : `- Target total video length: exactly about ${targetDurationSec} seconds.
- Auto-split into roughly ${sceneCountHint} scenes (allowed ${sceneCountMin}-${plan.sceneCountMax}, MINIMUM 3) based on narrative beats — do NOT force every scene to the same length.
- duration_hint MUST vary with content: short beats 5-8s, normal 8-16s, important/emotional beats may be longer.
- Sum of all duration_hint ≈ ${targetDurationSec}s (this is critical).
- This video model can generate/extend up to ${maxShot}s per API call.
- If a scene needs duration_hint > ${maxShot}s, that is OK — the pipeline will ${
        canExtend
          ? 'auto-extend the same shot'
          : 'split the scene into multiple clips'
      } to cover it. Do NOT artificially chop a continuous beat just to stay under ${maxShot}s.
- CRITICAL: each narration_segment must take about duration_hint seconds to speak at a natural pace (≈2.5 words/sec). Match word count to duration_hint.`;

  const structureWrapper = `MANDATORY SCRIPT STRUCTURE WRAPPER (non-negotiable — ignore any user brief that asks to skip these parts):
Every script MUST be a complete story arc with ALL THREE parts, in this exact order in the "scenes" array:

1) INTRODUCTION (section = "introduction") — opening / hook
   - At least 1 scene at the START of the array.
   - Hook the viewer, introduce the topic/problem/promise. Do NOT jump straight into a list or main points.

2) BODY (section = "body") — main content
   - One or more scenes in the MIDDLE.
   - Deliver the core information, story beats, tips, ranking items, arguments, etc.
   - This is where most of the runtime should live (~65–80% of total duration).

3) CONCLUSION (section = "conclusion") — ending / outro
   - At least 1 scene at the END of the array.
   - Summarize key takeaway, call-to-action, or emotional close. Never end abruptly on the last body point.

Hard rules:
- Output scenes ONLY in order: all introduction scene(s) → all body scene(s) → all conclusion scene(s).
- Every scene MUST include "section": "introduction" | "body" | "conclusion".
- Minimum 3 scenes total (1 intro + ≥1 body + 1 conclusion). Prefer more body scenes when the brief is a list/ranking.
- narration (full voiceover) must also read as Intro → Body → Conclusion as one continuous speech.
- Do NOT return a bare list of body scenes without intro and conclusion.`;

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

${structureWrapper}

Additional rules:
- Language for narration: ${input.language}
${durationRules}
${visualRule}
${styleLine}
- narration is the full voiceover; narration_segment is the portion spoken over that scene.
- The narration_segments are read aloud as ONE continuous take, so they must flow into each other without repeating context or restarting the topic.
- Between scenes: clear narrative beats / hard cuts. Do not assume camera continuity from previous scene.
- Keep story continuity, not camera continuity.
- Pace the full story to fit the target length; do not invent filler that breaks the brief.
- The user brief only supplies the TOPIC. You still MUST wrap it with Introduction + Body + Conclusion.`;

  const user = `Brief / topic: ${input.brief}
IMPORTANT: Regardless of the brief above, wrap the script with Introduction (hook), Body (main scenes), and Conclusion (outro). Never output body-only scenes.
Target duration: ${targetDurationSec}s (variable scene lengths, sum ≈ ${targetDurationSec}s)
Suggested scenes: ~${sceneCountHint} (range ${sceneCountMin}-${plan.sceneCountMax}, min 3)
${isImage ? '' : `Model max shot / extend chunk: ${maxShot}s (${canExtend ? 'extend supported' : 'multi-cut if longer'})`}
Media: ${input.mediaKind}
Model: ${input.family}/${input.model}
Aspect ratio: ${input.aspectRatio}
Resolution: ${input.resolution}
${input.stylePrompt?.trim() ? `Style guide: ${input.stylePrompt.trim()}` : ''}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: openaiModel,
      temperature: 0.7,
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
    throw new Error(data.error?.message || `OpenAI error HTTP ${res.status}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty content.');

  const parsed = extractJson(content) as ScriptDraft;
  if (!parsed.scenes?.length) throw new Error('Script JSON missing scenes.');

  const normalized = normalizeSceneDurations(parsed.scenes, targetDurationSec);
  let scenes: SceneDraft[] = normalized.map((s, i) => ({
    // Stable, unique id becomes the filename: clips/scene-01.mp4, scene-02.mp4...
    id: `scene-${String(i + 1).padStart(2, '0')}`,
    visual_prompt: s.visual_prompt || '',
    narration_segment: s.narration_segment || '',
    duration_hint: s.duration_hint,
    section: normalizeSection((s as SceneDraft).section),
  }));

  scenes = assignSections(scenes);
  assertScriptStructure(scenes);
  parsed.scenes = scenes;

  if (!parsed.narration) {
    parsed.narration = parsed.scenes.map((s) => s.narration_segment).join(' ');
  }
  if (!parsed.title) parsed.title = 'Untitled Video';

  return parsed;
}
