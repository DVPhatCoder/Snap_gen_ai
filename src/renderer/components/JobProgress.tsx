import type { JobProgress } from '../../shared/types';

const PHASE_LABEL: Record<string, string> = {
  idle: 'Chờ',
  tts: 'Voiceover',
  whisper: 'Đồng bộ lời',
  video: 'Render video',
  image: 'Render ảnh',
  merge: 'Ghép final',
  done: 'Xong',
  error: 'Lỗi',
};

export default function JobProgressView({ progress }: { progress: JobProgress | null }) {
  const percent = Math.min(100, Math.max(0, progress?.percent ?? 0));
  const isError = progress?.phase === 'error';
  const phaseLabel = progress?.phase ? PHASE_LABEL[progress.phase] || progress.phase : '';
  const detail =
    progress?.detailPercent != null &&
    (progress.phase === 'video' || progress.phase === 'image')
      ? Math.min(100, Math.max(0, progress.detailPercent))
      : null;

  return (
    <div className="progress-wrap">
      <div className="progress-head">
        <div>
          <span className={`status-dot ${progress && progress.phase !== 'idle' ? 'on' : ''}`} />
          {progress?.message || 'Chờ bắt đầu...'}
        </div>
        <strong className="progress-overall">{percent}%</strong>
      </div>

      {(progress?.sceneTotal != null && progress.sceneIndex != null) || detail != null ? (
        <p className="progress-meta muted">
          {phaseLabel ? `${phaseLabel} · ` : ''}
          {progress?.sceneTotal != null && progress.sceneIndex != null
            ? `Scene ${progress.sceneIndex + 1}/${progress.sceneTotal}`
            : null}
          {progress?.chunkTotal != null &&
          progress.chunkTotal > 1 &&
          progress.chunkIndex != null
            ? ` · đoạn ${progress.chunkIndex + 1}/${progress.chunkTotal}`
            : null}
          {detail != null ? ` · shot Snapgen ${detail}%` : null}
        </p>
      ) : null}

      <div className="bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${percent}%` }} />
      </div>

      {detail != null ? (
        <div className="bar bar-detail" title="Tiến độ render shot hiện tại trên Snapgen">
          <span style={{ width: `${detail}%` }} />
        </div>
      ) : null}

      {isError && progress?.error && <div className="msg error">{progress.error}</div>}
    </div>
  );
}
