import type { JobPhase, JobProgress } from '../shared/types';

export type ActiveJobKind = 'generate' | 'remux';

/** Điều khiển job đang chạy từ UI. */
export type JobControlState = 'running' | 'paused' | 'stop';

export interface ActiveJobSnapshot {
  active: boolean;
  projectId: string | null;
  projectName: string | null;
  kind: ActiveJobKind | null;
  progress: JobProgress | null;
  startedAt: number | null;
  control: JobControlState;
}

/** Shared flag so listProjects can heal stale "generating" badges. */
let activeJobs = 0;
let control: JobControlState = 'running';
let lastNonPausedPhase: JobPhase = 'idle';
let current: Omit<ActiveJobSnapshot, 'active' | 'control'> = {
  projectId: null,
  projectName: null,
  kind: null,
  progress: null,
  startedAt: null,
};

export function beginJob(options?: {
  projectId?: string;
  projectName?: string;
  kind?: ActiveJobKind;
}): void {
  activeJobs += 1;
  control = 'running';
  lastNonPausedPhase = 'idle';
  current = {
    projectId: options?.projectId ?? null,
    projectName: options?.projectName ?? null,
    kind: options?.kind ?? 'generate',
    progress: {
      phase: 'idle',
      message: 'Đang chuẩn bị pipeline...',
      percent: 0,
      control: 'running',
    },
    startedAt: Date.now(),
  };
}

export function endJob(): void {
  activeJobs = Math.max(0, activeJobs - 1);
  control = 'running';
  if (activeJobs === 0) {
    lastNonPausedPhase = 'idle';
    current = {
      projectId: null,
      projectName: null,
      kind: null,
      progress: null,
      startedAt: null,
    };
  }
}

export function isJobActive(): boolean {
  return activeJobs > 0;
}

export function getJobControl(): JobControlState {
  return control;
}

export function isJobPaused(): boolean {
  return control === 'paused';
}

export function isJobStopRequested(): boolean {
  return control === 'stop';
}

export function pauseActiveJob(): { ok: boolean; message: string } {
  if (activeJobs <= 0) return { ok: false, message: 'Không có job đang chạy.' };
  if (control === 'stop') return { ok: false, message: 'Job đang dừng hẳn.' };
  if (current.progress?.phase && current.progress.phase !== 'paused') {
    lastNonPausedPhase = current.progress.phase;
  }
  control = 'paused';
  if (current.progress) {
    current = {
      ...current,
      progress: {
        ...current.progress,
        phase: 'paused',
        control: 'paused',
        message:
          'Đã tạm dừng — không tạo scene mới (scene đang render sẽ chạy xong). Bấm Tiếp tục hoặc Dừng.',
      },
    };
  }
  return { ok: true, message: 'Đã tạm dừng tạo scene mới.' };
}

export function resumeActiveJob(): { ok: boolean; message: string } {
  if (activeJobs <= 0) return { ok: false, message: 'Không có job đang chạy.' };
  if (control === 'stop') return { ok: false, message: 'Job đã dừng — không resume được.' };
  control = 'running';
  if (current.progress) {
    current = {
      ...current,
      progress: {
        ...current.progress,
        phase: lastNonPausedPhase === 'paused' ? 'video' : lastNonPausedPhase,
        control: 'running',
        message: 'Tiếp tục render...',
      },
    };
  }
  return { ok: true, message: 'Đã tiếp tục job.' };
}

export function stopActiveJob(): { ok: boolean; message: string } {
  if (activeJobs <= 0) return { ok: false, message: 'Không có job đang chạy.' };
  control = 'stop';
  if (current.progress) {
    current = {
      ...current,
      progress: {
        ...current.progress,
        phase: 'paused',
        control: 'stop',
        message:
          'Đang dừng — bỏ scene còn lại trong hàng đợi để tiết kiệm token. Chờ scene đang render xong…',
      },
    };
  }
  return { ok: true, message: 'Đã yêu cầu dừng job.' };
}

export function updateActiveJobMeta(patch: {
  projectId?: string;
  projectName?: string;
}): void {
  if (activeJobs <= 0) return;
  current = {
    ...current,
    projectId: patch.projectId ?? current.projectId,
    projectName: patch.projectName ?? current.projectName,
  };
}

export function setActiveJobProgress(progress: JobProgress): void {
  if (activeJobs <= 0) return;
  if (progress.phase && progress.phase !== 'paused') {
    lastNonPausedPhase = progress.phase;
  }
  const ending = progress.phase === 'done' || progress.phase === 'error';
  const forcePhase =
    !ending && (control === 'paused' || control === 'stop')
      ? ('paused' as const)
      : progress.phase;
  current = {
    ...current,
    progress: {
      ...progress,
      phase: forcePhase,
      control: ending ? progress.control ?? control : control,
      message:
        ending
          ? progress.message
          : control === 'paused'
            ? 'Đã tạm dừng — không tạo scene mới. Bấm Tiếp tục hoặc Dừng.'
            : control === 'stop'
              ? progress.message ||
                'Đang dừng — bỏ scene còn lại. Chờ scene đang render xong…'
              : progress.message,
    },
  };
}

export function getActiveJob(): ActiveJobSnapshot {
  return {
    active: activeJobs > 0,
    projectId: current.projectId,
    projectName: current.projectName,
    kind: current.kind,
    progress: current.progress,
    startedAt: current.startedAt,
    control,
  };
}
