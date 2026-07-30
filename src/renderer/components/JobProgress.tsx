import type { JobProgress } from '../../shared/types';

export default function JobProgressView({ progress }: { progress: JobProgress | null }) {
  const percent = progress?.percent ?? 0;
  const isError = progress?.phase === 'error';

  return (
    <div className="progress-wrap">
      <div>
        <span className={`status-dot ${progress && progress.phase !== 'idle' ? 'on' : ''}`} />
        {progress?.message || 'Chờ bắt đầu...'}
      </div>
      {progress?.sceneTotal != null && progress.sceneIndex != null && (
        <p className="muted">
          Scene {progress.sceneIndex + 1}/{progress.sceneTotal}
        </p>
      )}
      <div className="bar">
        <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      {isError && progress?.error && <div className="msg error">{progress.error}</div>}
    </div>
  );
}
