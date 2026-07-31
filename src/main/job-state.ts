/** Shared flag so listProjects can heal stale "generating" badges. */
let activeJobs = 0;

export function beginJob(): void {
  activeJobs += 1;
}

export function endJob(): void {
  activeJobs = Math.max(0, activeJobs - 1);
}

export function isJobActive(): boolean {
  return activeJobs > 0;
}
