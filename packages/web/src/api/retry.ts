/**
 * M2.2: Exponential Backoff Retry Utility
 *
 * Handles 503 (backpressure) responses from server with exponential backoff.
 * Used by packages/web/src/api/client.ts
 */

export interface RetryConfig {
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  onRetry?: (attempt: number, backoffMs: number, error: Error) => void;
}

export async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig = {}): Promise<T> {
  const { maxRetries = 5, baseBackoffMs = 1000, maxBackoffMs = 60_000, onRetry } = config;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err as any;
      lastError = err as Error;

      // Only retry on 503 (Service Unavailable / backpressure)
      // ApiError has .status property
      if (error?.status !== 503) {
        throw err;
      }

      // Don't retry after exhausting attempts
      if (attempt >= maxRetries) {
        console.warn(
          `⚠️ WARN: All retries exhausted (${maxRetries + 1} attempts) [BACKPRESSURE_EXHAUSTED]`,
          { error: error.message }
        );
        throw err;
      }

      // Calculate exponential backoff with jitter
      const exponential = baseBackoffMs * 2 ** attempt;
      const jittered = exponential * (0.9 + Math.random() * 0.2); // ±10% jitter
      const backoffMs = Math.min(jittered, maxBackoffMs);

      console.debug(
        `🔄 DEBUG: Retrying after 503 backpressure (attempt ${attempt + 1}/${maxRetries + 1}, backoff ${backoffMs.toFixed(0)}ms) [RETRY]`,
        { attempt, backoffMs, error: error.message }
      );

      onRetry?.(attempt + 1, backoffMs, error);

      // Sleep before retry
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError || new Error("Unknown error");
}

/**
 * Helper: Wraps a fetch call with retry logic
 *
 * Usage:
 * const data = await retryFetch('/api/tasks', { method: 'POST', body: ... });
 */
export async function retryFetch<T>(
  url: string,
  init?: RequestInit,
  config?: RetryConfig
): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(url, init);

    if (!res.ok) {
      const errorBody = await res.text();
      const error = new Error(`HTTP ${res.status}: ${errorBody || res.statusText}`) as any;
      error.status = res.status;
      throw error;
    }

    return (await res.json()) as T;
  }, config);
}
