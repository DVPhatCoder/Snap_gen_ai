import { useEffect, useState } from 'react';
import type { ActiveJobSnapshot, JobProgress } from '../../shared/types';
import JobProgressView from './JobProgress';

/**
 * Hiện khi đang gen mà user thoát Studio (Projects / Settings).
 * Main vẫn chạy job — banner gắn lại progress để khỏi tưởng app treo.
 */
export default function GlobalJobBanner({
  visible,
  onOpenProject,
}: {
  visible: boolean;
  onOpenProject: (projectId: string) => void;
}) {
  const [job, setJob] = useState<ActiveJobSnapshot | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const snap = await window.studio.getActiveJob();
        if (cancelled) return;
        setJob(snap.active ? snap : null);
        if (snap.active && snap.progress) setProgress(snap.progress);
        if (!snap.active) setProgress(null);
      } catch {
        if (!cancelled) setJob(null);
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 1500);
    const offProgress = window.studio.onJobProgress((p) => {
      setProgress(p);
      setJob((prev) =>
        prev?.active
          ? { ...prev, progress: p }
          : {
              active: true,
              projectId: null,
              projectName: null,
              kind: 'generate',
              progress: p,
              startedAt: Date.now(),
            }
      );
    });
    const offFinished = window.studio.onJobFinished(() => {
      setJob(null);
      setProgress(null);
      void pull();
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      offProgress();
      offFinished();
    };
  }, [visible]);

  if (!visible || !job?.active) return null;

  const title = job.projectName || 'Dự án';
  const pct = Math.min(100, Math.max(0, progress?.percent ?? job.progress?.percent ?? 0));

  return (
    <div className="global-job-banner" role="status">
      <div className="global-job-banner-copy">
        <strong>
          Đang render nền · {title} · {pct}%
        </strong>
        <span>{progress?.message || job.progress?.message || 'Job đang chạy trên main process…'}</span>
      </div>
      <div className="global-job-banner-actions">
        {job.projectId ? (
          <button type="button" className="btn" onClick={() => onOpenProject(job.projectId!)}>
            Mở dự án
          </button>
        ) : null}
      </div>
      <div className="global-job-banner-bar">
        <JobProgressView progress={progress || job.progress} />
      </div>
    </div>
  );
}
