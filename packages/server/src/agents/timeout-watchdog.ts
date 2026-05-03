/**
 * M2.3: Task Timeout Watchdog
 *
 * Implements per-task timeout enforcement.
 * Wraps executor with Promise.race(executor, timeout).
 * On timeout: marks task as failed, cleans up worktree.
 */

import type { AgentRun } from "@vibe-code/shared";

export interface TimeoutConfig {
  defaultTimeoutMs?: number; // Default: 3600000 (1 hour)
  maxTimeoutMs?: number; // Safety cap: 86400000 (24 hours)
}

export class TimeoutWatchdog {
  private timeouts = new Map<string, NodeJS.Timeout>();
  private config: Required<TimeoutConfig>;

  constructor(config: TimeoutConfig = {}) {
    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs ?? 3_600_000, // 1 hour
      maxTimeoutMs: config.maxTimeoutMs ?? 86_400_000, // 24 hours
    };
  }

  /**
   * Wrap an executor promise with timeout enforcement.
   * Returns the result OR rejects with TimeoutError if timeout exceeded.
   *
   * [TIMEOUT] — logs when timeout occurs
   */
  async executeWithTimeout<T>(
    taskId: string,
    executor: Promise<T>,
    timeoutMsOverride?: number
  ): Promise<T> {
    const timeoutMs = Math.min(
      timeoutMsOverride ?? this.config.defaultTimeoutMs,
      this.config.maxTimeoutMs
    );

    return Promise.race([executor, this.createTimeoutPromise<T>(taskId, timeoutMs)]);
  }

  /**
   * Cancel an active timeout for a task
   */
  cancel(taskId: string): void {
    const timeout = this.timeouts.get(taskId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(taskId);
      console.debug(`🔍 DEBUG: Timeout watchdog cancelled for task ${taskId}`);
    }
  }

  /**
   * Cancel all active timeouts (e.g., on graceful shutdown)
   */
  cancelAll(): void {
    for (const [taskId, timeout] of this.timeouts) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    console.info(`✅ INFO: All timeout watchdogs cancelled`);
  }

  private createTimeoutPromise<T>(taskId: string, timeoutMs: number): Promise<T> {
    return new Promise((_, reject) => {
      const timeout = setTimeout(() => {
        this.timeouts.delete(taskId);
        const error = new TimeoutError(`Task ${taskId} exceeded timeout of ${timeoutMs}ms`);
        console.error(
          `❌ ERROR: Task timeout after ${(timeoutMs / 1000).toFixed(1)}s task_id=${taskId} [TIMEOUT]`,
          {
            taskId,
            durationMs: timeoutMs,
            error: error.message,
          }
        );
        reject(error);
      }, timeoutMs);

      this.timeouts.set(taskId, timeout);

      // Log halfway point
      setTimeout(() => {
        if (this.timeouts.has(taskId)) {
          console.warn(
            `⚠️ WARN: Task timeout at 50% (${(timeoutMs / 2000).toFixed(1)}s elapsed) task_id=${taskId} [TIMEOUT_WARNING]`,
            { taskId, halfwayMs: timeoutMs / 2 }
          );
        }
      }, timeoutMs / 2);
    });
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}
