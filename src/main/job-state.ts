import type { JobProgress } from '../shared/types';

export type ActiveJobKind = 'generate' | 'remux';

export interface ActiveJobSnapshot {
  active: boolean;
  projectId: string | null;
  projectName: string | null;
  kind: ActiveJobKind | null;
  progress: JobProgress | null;
  startedAt: number | null;
}

/** Shared flag so listProjects can heal stale "generating" badges. */
let activeJobs = 0;
let current: Omit<ActiveJobSnapshot, 'active'> = {
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
  current = {
    projectId: options?.projectId ?? null,
    projectName: options?.projectName ?? null,
    kind: options?.kind ?? 'generate',
    progress: {
      phase: 'idle',
      message: 'Đang chuẩn bị pipeline...',
      percent: 0,
    },
    startedAt: Date.now(),
  };
}

export function endJob(): void {
  activeJobs = Math.max(0, activeJobs - 1);
  if (activeJobs === 0) {
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
  current = { ...current, progress };
}

export function getActiveJob(): ActiveJobSnapshot {
  return {
    active: activeJobs > 0,
    projectId: current.projectId,
    projectName: current.projectName,
    kind: current.kind,
    progress: current.progress,
    startedAt: current.startedAt,
  };
}
