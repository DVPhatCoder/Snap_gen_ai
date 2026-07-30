import type { ScriptDraft } from '../../shared/types';
import { clampDuration } from '../../shared/models';

interface Props {
  script: ScriptDraft;
  onChange: (s: ScriptDraft) => void;
  modelId: string;
}

export default function SceneEditor({ script, onChange, modelId }: Props) {
  const updateScene = (index: number, patch: Partial<ScriptDraft['scenes'][number]>) => {
    const scenes = script.scenes.map((s, i) => (i === index ? { ...s, ...patch } : s));
    const narration = scenes.map((s) => s.narration_segment).join(' ');
    onChange({ ...script, scenes, narration });
  };

  const addScene = () => {
    const scenes = [
      ...script.scenes,
      {
        id: `scene-${script.scenes.length + 1}`,
        visual_prompt: '',
        narration_segment: '',
        duration_hint: clampDuration(modelId, 8),
      },
    ];
    onChange({ ...script, scenes });
  };

  const removeScene = (index: number) => {
    if (script.scenes.length <= 1) return;
    const scenes = script.scenes.filter((_, i) => i !== index);
    onChange({
      ...script,
      scenes,
      narration: scenes.map((s) => s.narration_segment).join(' '),
    });
  };

  return (
    <div>
      <div className="field">
        <label htmlFor="title">Tiêu đề</label>
        <input
          id="title"
          value={script.title}
          onChange={(e) => onChange({ ...script, title: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="narration">Narration đầy đủ (ElevenLabs)</label>
        <textarea
          id="narration"
          value={script.narration}
          onChange={(e) => onChange({ ...script, narration: e.target.value })}
        />
      </div>

      {script.scenes.map((scene, index) => (
        <div className="scene-card" key={scene.id}>
          <div className="scene-head">
            <strong>Cảnh {index + 1}</strong>
            <button type="button" className="btn ghost" onClick={() => removeScene(index)}>
              Xóa
            </button>
          </div>
          <div className="field">
            <label>Visual prompt (Snapgen)</label>
            <textarea
              value={scene.visual_prompt}
              onChange={(e) => updateScene(index, { visual_prompt: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Narration segment</label>
            <textarea
              value={scene.narration_segment}
              onChange={(e) => updateScene(index, { narration_segment: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Duration hint (giây)</label>
            <input
              type="number"
              value={scene.duration_hint}
              onChange={(e) =>
                updateScene(index, {
                  duration_hint: clampDuration(modelId, Number(e.target.value) || 8),
                })
              }
            />
          </div>
        </div>
      ))}

      <button type="button" className="btn" onClick={addScene}>
        Thêm cảnh
      </button>
    </div>
  );
}
