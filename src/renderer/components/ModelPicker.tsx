import type { ModelOption, VideoFamily } from '../../shared/types';

interface Props {
  families: { id: VideoFamily; label: string }[];
  models: ModelOption[];
  family: VideoFamily;
  modelId: string;
  aspectRatio: string;
  resolution: string;
  mode: string;
  onFamilyChange: (f: VideoFamily) => void;
  onModelChange: (id: string) => void;
  onAspectRatioChange: (v: string) => void;
  onResolutionChange: (v: string) => void;
  onModeChange: (v: string) => void;
}

export default function ModelPicker(props: Props) {
  const familyModels = props.models.filter((m) => m.family === props.family);
  const selected = familyModels.find((m) => m.id === props.modelId) ?? familyModels[0];
  const modes = selected?.extraFields?.mode ?? [];

  return (
    <div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="family">Video family</label>
          <select
            id="family"
            value={props.family}
            onChange={(e) => props.onFamilyChange(e.target.value as VideoFamily)}
          >
            {props.families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="model">Model</label>
          <select
            id="model"
            value={props.modelId}
            onChange={(e) => props.onModelChange(e.target.value)}
          >
            {familyModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="ar">Aspect ratio</label>
          <select
            id="ar"
            value={props.aspectRatio}
            onChange={(e) => props.onAspectRatioChange(e.target.value)}
          >
            {(selected?.aspectRatios ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="res">Resolution</label>
          <select
            id="res"
            value={props.resolution}
            onChange={(e) => props.onResolutionChange(e.target.value)}
          >
            {(selected?.resolutions ?? []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {modes.length > 0 && (
        <div className="field">
          <label htmlFor="mode">Mode</label>
          <select id="mode" value={props.mode} onChange={(e) => props.onModeChange(e.target.value)}>
            {modes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="muted">
        Duration gợi ý / cảnh: {(selected?.durations ?? []).join(', ')}s — ChatGPT sẽ clamp theo
        model.
      </p>
    </div>
  );
}
