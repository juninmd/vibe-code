/**
 * M3: Workflow Memory Service (Compozy-inspired)
 * Two-tier memory model:
 * - 'shared' scope: cross-task memory accessible by all runs
 * - 'task' scope: per-task memory private to that task's runs
 * Auto-flags memory for compaction when content exceeds 150 lines.
 */

import type { Db } from "../db";
import type { WorkflowMemory } from "../db/queries";

export interface MemoryServiceResult {
  memory: WorkflowMemory | null;
  needsCompaction: boolean;
}

const COMPACTION_THRESHOLD = 150; // lines

function countLines(content: string): number {
  return content.split("\n").length;
}

export class MemoryService {
  constructor(private db: Db) {}

  /**
   * Get memory for a task in a specific scope.
   * Returns null if no memory exists yet.
   */
  async getMemory(taskId: string, scope: "shared" | "task"): Promise<MemoryServiceResult> {
    const memory = this.db.memories.getByTaskIdAndScope(taskId, scope);
    const needsCompaction = memory
      ? memory.needsCompaction || countLines(memory.content) > COMPACTION_THRESHOLD
      : false;
    return { memory, needsCompaction };
  }

  /**
   * Upsert memory for a task. If memory doesn't exist, creates it.
   * If it exists, updates the content and compactedAt if provided.
   */
  async upsertMemory(
    taskId: string,
    scope: "shared" | "task",
    content: string,
    options?: { compactedAt?: string }
  ): Promise<WorkflowMemory> {
    const existing = this.db.memories.getByTaskIdAndScope(taskId, scope);

    if (existing) {
      // Update existing memory
      const needsCompaction = countLines(content) > COMPACTION_THRESHOLD;
      const memory = this.db.memories.update(existing.id, {
        content,
        needsCompaction,
        compactedAt: options?.compactedAt ?? existing.compactedAt,
      });
      return memory;
    } else {
      // Create new memory
      const needsCompaction = countLines(content) > COMPACTION_THRESHOLD;
      const memory = this.db.memories.create({
        taskId,
        scope,
        content,
        needsCompaction,
      });
      return memory;
    }
  }

  /**
   * Mark memory as compacted and reset the flag.
   */
  async compactMemory(
    taskId: string,
    scope: "shared" | "task",
    newContent: string
  ): Promise<WorkflowMemory> {
    const memory = this.db.memories.getByTaskIdAndScope(taskId, scope);
    if (!memory) {
      throw new Error(`Memory not found for task ${taskId} with scope ${scope}`);
    }

    return this.db.memories.update(memory.id, {
      content: newContent,
      needsCompaction: false,
      compactedAt: new Date().toISOString(),
    });
  }

  /**
   * Get memory content for assembly into a prompt.
   * Returns combined prompt with both shared and task-specific memory.
   */
  getMemoryPromptSection(sharedMemory: string | null, taskMemory: string | null): string {
    const sections: string[] = [];

    if (sharedMemory) {
      sections.push(`## Shared Knowledge (from previous runs):\n\n${sharedMemory}`);
    }

    if (taskMemory) {
      sections.push(`## Task-Specific Context (this task's history):\n\n${taskMemory}`);
    }

    return sections.length > 0 ? `\n\n${sections.join("\n\n")}\n\n` : "";
  }
}
