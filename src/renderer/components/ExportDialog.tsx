import { useEffect, useMemo, useState } from 'react';
import type { ExportMode, SceneMediaAsset, ScriptDraft } from '../../shared/types';

export interface ExportableScene {
  index: number;
  sceneId: string;
  label: string;
  prompt: string;
  duration: number;
  path: string;
  kind: 'video' | 'image';
}

interface Props {
  open: boolean;
  script: ScriptDraft | null;
  sceneMedia: SceneMediaAsset[];
  hasFinal: boolean;
  projectName: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    mode: ExportMode;
    selectedSceneIds: string[];
  }) => void;
}

export function buildExportableScenes(
  script: ScriptDraft | null,
  sceneMedia: SceneMediaAsset[]
): ExportableScene[] {
  if (!script?.scenes.length) return [];
  return script.scenes
    .map((scene, index) => {
      const asset =
        sceneMedia.find((item) => item.sceneId === scene.id) ?? sceneMedia[index] ?? null;
      if (!asset?.exists || !asset.path) return null;
      return {
        index,
        sceneId: scene.id,
        label: `Scene ${index + 1}`,
        prompt: scene.visual_prompt || scene.narration_segment || 'Untitled',
        duration: scene.duration_hint,
        path: asset.path,
        kind: asset.kind,
      } satisfies ExportableScene;
    })
    .filter((item): item is ExportableScene => Boolean(item));
}

export default function ExportDialog({
  open,
  script,
  sceneMedia,
  hasFinal,
  projectName,
  busy,
  onClose,
  onConfirm,
}: Props) {
  const exportable = useMemo(
    () => buildExportableScenes(script, sceneMedia),
    [script, sceneMedia]
  );
  const [mode, setMode] = useState<ExportMode>(hasFinal ? 'final' : 'scenes');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setMode(hasFinal ? 'final' : 'scenes');
    setSelected(new Set(exportable.map((item) => item.sceneId)));
  }, [open, hasFinal, exportable]);

  if (!open) return null;

  const allSelected = exportable.length > 0 && selected.size === exportable.length;
  const canConfirm =
    mode === 'final'
      ? hasFinal
      : selected.size > 0 && exportable.some((item) => selected.has(item.sceneId));

  const toggle = (sceneId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="export-dialog-title">Lưu video</h2>
            <p>{projectName || 'Untitled project'}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </header>

        <div className="export-mode-grid">
          <label className={`export-mode-card ${mode === 'final' ? 'active' : ''} ${!hasFinal ? 'disabled' : ''}`}>
            <input
              type="radio"
              name="export-mode"
              checked={mode === 'final'}
              disabled={!hasFinal}
              onChange={() => setMode('final')}
            />
            <strong>Bản Final</strong>
            <span>Lưu video đã ghép đầy đủ (1 file).</span>
          </label>
          <label
            className={`export-mode-card ${mode === 'scenes' ? 'active' : ''} ${
              !exportable.length ? 'disabled' : ''
            }`}
          >
            <input
              type="radio"
              name="export-mode"
              checked={mode === 'scenes'}
              disabled={!exportable.length}
              onChange={() => setMode('scenes')}
            />
            <strong>Từng phân cảnh</strong>
            <span>Chọn nhiều clip/ảnh scene để lưu vào thư mục.</span>
          </label>
        </div>

        {mode === 'scenes' && (
          <div className="export-scene-picker">
            <div className="export-scene-toolbar">
              <strong>
                {selected.size}/{exportable.length} phân cảnh
              </strong>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!exportable.length}
                  onClick={() => setSelected(new Set(exportable.map((item) => item.sceneId)))}
                >
                  Chọn tất cả
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!selected.size}
                  onClick={() => setSelected(new Set())}
                >
                  Bỏ chọn
                </button>
              </div>
            </div>
            {!exportable.length ? (
              <p className="hint">Chưa có phân cảnh nào để lưu. Hãy Generate trước.</p>
            ) : (
              <ul className="export-scene-list">
                {exportable.map((item) => (
                  <li key={item.sceneId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.has(item.sceneId)}
                        onChange={() => toggle(item.sceneId)}
                      />
                      <span className="export-scene-meta">
                        <strong>
                          {item.label}
                          <small>
                            · {item.duration}s · {item.kind === 'image' ? 'ảnh' : 'video'}
                          </small>
                        </strong>
                        <em>{item.prompt}</em>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {allSelected && exportable.length > 0 && (
              <p className="hint">Đã chọn tất cả phân cảnh.</p>
            )}
          </div>
        )}

        {mode === 'final' && !hasFinal && (
          <p className="hint">Chưa có bản Final. Generate hoặc ghép lại timeline trước.</p>
        )}

        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canConfirm || busy}
            onClick={() =>
              onConfirm({
                mode,
                selectedSceneIds: [...selected],
              })
            }
          >
            {busy ? 'Đang lưu...' : mode === 'final' ? 'Chọn nơi lưu Final' : 'Chọn thư mục lưu'}
          </button>
        </footer>
      </div>
    </div>
  );
}
