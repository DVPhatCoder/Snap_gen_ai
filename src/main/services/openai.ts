import type { GenerateIdeaInput, ScriptDraft } from '../../shared/types';
import { clampDuration } from '../../shared/models';

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
  const system = `You are a professional AI video director and screenwriter.
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
- Create exactly ${input.sceneCount} scenes.
- visual_prompt must be detailed cinematic English suitable for text-to-video AI (camera, lighting, motion).
- narration is the full voiceover; narration_segment is the portion spoken over that scene.
- duration_hint should be near ${input.durationPerScene ?? 8} seconds and realistic for spoken segment length.
- Keep visual continuity across scenes.`;

  const user = `Brief: ${input.brief}
Video model: ${input.family}/${input.model}
Aspect ratio: ${input.aspectRatio}
Resolution: ${input.resolution}`;

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

  parsed.scenes = parsed.scenes.map((s, i) => ({
    id: s.id || `scene-${i + 1}`,
    visual_prompt: s.visual_prompt || '',
    narration_segment: s.narration_segment || '',
    duration_hint: clampDuration(input.model, Number(s.duration_hint) || input.durationPerScene || 8),
  }));

  if (!parsed.narration) {
    parsed.narration = parsed.scenes.map((s) => s.narration_segment).join(' ');
  }
  if (!parsed.title) parsed.title = 'Untitled Video';

  return parsed;
}
