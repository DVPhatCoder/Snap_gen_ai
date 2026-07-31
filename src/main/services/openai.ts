import type { GenerateIdeaInput, ScriptDraft } from '../../shared/types';
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
  const sceneCountHint =
    input.sceneCount && input.sceneCount > 0 ? input.sceneCount : plan.sceneCountHint;

  const styleLine = input.stylePrompt?.trim()
    ? `- Global visual style (MUST apply to every visual_prompt for consistency): ${input.stylePrompt.trim()}`
    : '- Keep visual continuity and a consistent look across scenes.';

  const visualRule = isImage
    ? '- visual_prompt must be detailed English suitable for text-to-image AI (composition, lighting, subject, camera angle). Do NOT describe motion or camera moves over time.'
    : '- visual_prompt must be detailed cinematic English suitable for text-to-video AI (camera, lighting, motion). Each scene is a SEPARATE shot with a hard cut — do NOT write as one continuous take across scenes.';

  const durationRules = isImage
    ? `- Create about ${sceneCountHint} scenes (allowed range ${plan.sceneCountMin}-${plan.sceneCountMax}).
- duration_hint is the slide / narration window for that scene in seconds.
- Vary duration_hint by content; denser narration → longer duration_hint.
- Sum of all duration_hint must be approximately ${targetDurationSec} seconds.`
    : `- Target total video length: exactly about ${targetDurationSec} seconds.
- Auto-split into roughly ${sceneCountHint} scenes (allowed ${plan.sceneCountMin}-${plan.sceneCountMax}) based on narrative beats — do NOT force every scene to the same length.
- duration_hint MUST vary with content: short beats 5-8s, normal 8-16s, important/emotional beats may be longer.
- Sum of all duration_hint ≈ ${targetDurationSec}s (this is critical).
- This video model can generate/extend up to ${maxShot}s per API call.
- If a scene needs duration_hint > ${maxShot}s, that is OK — the pipeline will ${
        canExtend
          ? 'auto-extend the same shot'
          : 'split the scene into multiple clips'
      } to cover it. Do NOT artificially chop a continuous beat just to stay under ${maxShot}s.
- CRITICAL: each narration_segment must take about duration_hint seconds to speak at a natural pace (≈2.5 words/sec). Match word count to duration_hint.`;

  const system = `You are a professional AI ${isImage ? 'art director' : 'video director'} and screenwriter.
Return ONLY valid JSON (no markdown) with this exact shape:
{
  "title": string,
  "narration": string,
  "scenes": [
    {
      "id": string,
      "visual_prompt": string,
      "narration_segment": string,
      "duration_hint": number
    }
  ]
}
Rules:
- Language for narration: ${input.language}
${durationRules}
${visualRule}
${styleLine}
- narration is the full voiceover; narration_segment is the portion spoken over that scene.
- The narration_segments are read aloud as ONE continuous take, so they must flow into each other without repeating context or restarting the topic.
- Between scenes: clear narrative beats / hard cuts. Do not assume camera continuity from previous scene.
- Keep story continuity, not camera continuity.
- Pace the full story to fit the target length; do not invent filler that breaks the brief.`;

  const user = `Brief: ${input.brief}
Target duration: ${targetDurationSec}s (variable scene lengths, sum ≈ ${targetDurationSec}s)
Suggested scenes: ~${sceneCountHint} (range ${plan.sceneCountMin}-${plan.sceneCountMax})
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
  parsed.scenes = normalized.map((s, i) => ({
    // Stable, unique id becomes the filename: clips/scene-01.mp4, scene-02.mp4...
    id: `scene-${String(i + 1).padStart(2, '0')}`,
    visual_prompt: s.visual_prompt || '',
    narration_segment: s.narration_segment || '',
    duration_hint: s.duration_hint,
  }));

  if (!parsed.narration) {
    parsed.narration = parsed.scenes.map((s) => s.narration_segment).join(' ');
  }
  if (!parsed.title) parsed.title = 'Untitled Video';

  return parsed;
}
