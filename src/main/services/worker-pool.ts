/**
 * Worker pool: chạy tối đa `concurrency` task cùng lúc.
 * Không dùng Promise.all(all) — worker lấy job tiếp theo khi xong.
 */

export type PoolTask<T> = () => Promise<T>;

export interface RunPoolOptions {
  concurrency: number;
  /** Gọi khi một task settle (ok hoặc lỗi) — index theo thứ tự input. */
  onSettled?: (index: number, result: PromiseSettledResult<unknown>) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chạy `tasks` với giới hạn concurrency. Giữ thứ tự kết quả theo index.
 * Task lỗi → reject phần tử đó; các worker khác vẫn chạy.
 */
export async function runPool<T>(
  tasks: Array<PoolTask<T>>,
  options: RunPoolOptions
): Promise<Array<PromiseSettledResult<T>>> {
  const concurrency = Math.max(1, Math.min(options.concurrency, tasks.length || 1));
  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= tasks.length) return;
      try {
        const value = await tasks[index]();
        const settled: PromiseFulfilledResult<T> = { status: 'fulfilled', value };
        results[index] = settled;
        options.onSettled?.(index, settled);
      } catch (reason) {
        const settled: PromiseRejectedResult = { status: 'rejected', reason };
        results[index] = settled;
        options.onSettled?.(index, settled);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

export function isRetryableMediaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit|timeout|etimedout|econnreset|enotfound|eai_again|503|502|504|524|temporar|try again|overloaded|too many requests|gateway|network|fetch failed|socket/i.test(
    msg
  );
}

export async function withRetries<T>(
  label: string,
  fn: (attempt: number) => Promise<T>,
  options?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
  }
): Promise<T> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const baseDelayMs = options?.baseDelayMs ?? 2000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const retryable = isRetryableMediaError(err);
      if (!retryable || attempt >= maxAttempts) break;
      const delayMs = Math.min(30_000, baseDelayMs * 2 ** (attempt - 1));
      options?.onRetry?.(attempt, err, delayMs);
      await sleep(delayMs);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label}: ${detail}`);
}
