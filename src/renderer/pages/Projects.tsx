import { useCallback, useEffect, useState } from 'react';
import type { ProjectMeta } from '../../shared/types';

interface Props {
  onOpenProject: (id: string) => void;
  onCreateAndOpen: (id: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Nháp',
  generating: 'Đang gen',
  ready: 'Hoàn tất',
  error: 'Lỗi',
};

export default function Projects({ onOpenProject, onCreateAndOpen }: Props) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const refresh = useCallback(async () => {
    setProjects(await window.studio.listProjects());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While any project is "generating", keep the list fresh so badge flips to Hoàn tất.
  useEffect(() => {
    const hasGenerating = projects.some((p) => p.status === 'generating');
    if (!hasGenerating) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [projects, refresh]);

  const create = async () => {
    if (!newName.trim()) {
      setError('Nhập tên dự án trước.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const meta = await window.studio.createProject({ name: newName.trim() });
      setNewName('');
      await refresh();
      onCreateAndOpen(meta.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async (id: string) => {
    if (!renameValue.trim()) {
      setError('Tên dự án không được để trống.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.studio.renameProject(id, renameValue.trim());
      setRenamingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    const ok = window.confirm(`Xóa dự án "${name}"? Thư mục media cũng sẽ bị xóa.`);
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await window.studio.deleteProject(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-hero">
        <p className="eyebrow">Library</p>
        <h1>Dự án</h1>
        <p className="sub">Tạo dự án mới với tên riêng, mở lại, đổi tên hoặc xóa.</p>
      </div>

      <div className="create-row">
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label htmlFor="new-project">Tên dự án mới</label>
          <input
            id="new-project"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ví dụ: Cafe Da Nang — teaser 30s"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
          />
        </div>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void create()}>
          Tạo &amp; mở
        </button>
      </div>

      {projects.length === 0 ? (
        <p className="muted" style={{ marginTop: 24 }}>
          Chưa có dự án nào. Tạo dự án đầu tiên ở trên.
        </p>
      ) : (
        <div className="project-list">
          {projects.map((p) => (
            <div className="project-card" key={p.id}>
              <div className="project-main">
                {renamingId === p.id ? (
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename(p.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <div>
                    <strong>{p.name}</strong>
                    <div className="muted" style={{ marginTop: 4 }}>
                      <span className={`badge badge-${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                      {' · '}
                      {p.model ?? '—'}
                      {' · '}
                      cập nhật {new Date(p.updatedAt).toLocaleString('vi-VN')}
                    </div>
                    {p.brief ? (
                      <div className="muted" style={{ marginTop: 6 }}>
                        {p.brief.slice(0, 120)}
                        {p.brief.length > 120 ? '…' : ''}
                      </div>
                    ) : null}
                    {p.status === 'error' && p.lastError ? (
                      <div className="msg error" style={{ marginTop: 8 }}>
                        {p.lastError}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="project-actions">
                {renamingId === p.id ? (
                  <>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy}
                      onClick={() => void saveRename(p.id)}
                    >
                      Lưu tên
                    </button>
                    <button type="button" className="btn ghost" onClick={() => setRenamingId(null)}>
                      Hủy
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn primary" onClick={() => onOpenProject(p.id)}>
                      Mở
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setRenamingId(p.id);
                        setRenameValue(p.name);
                      }}
                    >
                      Đổi tên
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy}
                      onClick={() => void remove(p.id, p.name)}
                    >
                      Xóa
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="msg error">{error}</div>}
    </div>
  );
}
