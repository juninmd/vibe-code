/**
 * M2: Circuit Breaker & Backpressure Queue
 *
 * Implements:
 * - Task queue (max 10 pending)
 * - 503 Backpressure response when full
 * - Queue metrics for monitoring
 * - FIFO with priority support
 */

import type { Task } from "@vibe-code/shared";

export interface QueuedTask {
  task: Task;
  addedAt: number;
  priority: number;
}

export class TaskQueue {
  private pending: QueuedTask[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 10) {
    this.maxSize = maxSize;
  }

  /**
   * Try to enqueue a task.
   * Returns true if enqueued, false if queue is full (would return 503)
   *
   * [BACKPRESSURE] — logs when queue is full
   */
  enqueue(task: Task): boolean {
    if (this.pending.length >= this.maxSize) {
      console.error(
        `❌ ERROR: Queue full (${this.pending.length}/${this.maxSize}) rejecting task [BACKPRESSURE]`,
        {
          taskId: task.id,
          taskTitle: task.title,
        }
      );
      return false;
    }

    const priority = this.getPriority(task.priority);
    this.pending.push({ task, addedAt: Date.now(), priority });

    // Sort by priority (descending) then by arrival time (ascending)
    this.pending.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.addedAt - b.addedAt;
    });

    console.info(`✅ INFO: Task enqueued`, {
      taskId: task.id,
      taskTitle: task.title,
      queueDepth: this.pending.length,
      maxSize: this.maxSize,
    });

    return true;
  }

  /**
   * Get next task from queue (FIFO with priority)
   */
  dequeue(): QueuedTask | undefined {
    return this.pending.shift();
  }

  /**
   * Peek at next task without removing it
   */
  peek(): QueuedTask | undefined {
    return this.pending[0];
  }

  /**
   * Get current queue depth
   */
  size(): number {
    return this.pending.length;
  }

  /**
   * Get queue stats for monitoring
   */
  stats() {
    return {
      depth: this.pending.length,
      max: this.maxSize,
      isFull: this.pending.length >= this.maxSize,
      percentFull: (this.pending.length / this.maxSize) * 100,
      // Oldest pending task age
      oldestAgeMs: this.pending.length > 0 ? Date.now() - this.pending[0]?.addedAt : 0,
    };
  }

  /**
   * Clear queue (emergency drain)
   */
  clear(): void {
    const count = this.pending.length;
    this.pending = [];
    console.warn(`⚠️ WARN: Queue cleared (${count} tasks dropped) [DRAIN]`);
  }

  private getPriority(priorityStr?: string): number {
    const map: Record<string, number> = {
      urgent: 4,
      high: 3,
      medium: 2,
      low: 1,
      none: 0,
    };
    return map[priorityStr?.toLowerCase() ?? "none"] ?? 0;
  }
}

/**
 * Exponential backoff calculator for client-side retries
 * Used by web/src/api/client.ts for M2.2
 */
export function calculateBackoffMs(attemptNumber: number, maxAttempts = 5): number {
  if (attemptNumber >= maxAttempts) return -1; // signal: no more retries

  const baseMs = 1000; // 1s
  const expBackoff = baseMs * 2 ** attemptNumber;
  const maxBackoff = 60_000; // cap at 60s
  const jittered = expBackoff + Math.random() * (expBackoff * 0.1); // ±10% jitter

  return Math.min(jittered, maxBackoff);
}
