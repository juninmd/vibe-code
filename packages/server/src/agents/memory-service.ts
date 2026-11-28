/**
 * M3: Workflow Memory Service (Compozy-inspired)
 * Two-tier memory model:
 * - 'shared' scope: cross-task memory accessible by all runs
 * - 'task' scope: per-task memory private to that task's runs
 * Auto-flags memory for compaction when content exceeds 150 lines.
 */

import type { Task } from "@vibe-code/shared";
import type { Db } from "../db";
import type { WorkflowMemory } from "../db/queries";

export interface MemoryServiceResult {
  memory: WorkflowMemory | null;
  needsCompaction: boolean;
}

export interface RetrievedMemoryEntry {
  taskId: string;
  scope: "shared" | "task";
  source: "memory" | "artifact";
  score: number;
  reason: string;
  content: string;
  updatedAt: string;
}

export interface RetrievedMemoryContext {
  sharedMemory: string | null;
  taskMemory: string | null;
  entries: RetrievedMemoryEntry[];
  needsCompaction: boolean;
}

export interface RunMemorySummary {
  runId: string;
  finalStatus: string;
  qualityScore: number;
  validatorAttempts: number;
  reviewBlockers: number;
  reviewWarnings: number;
  validationSummary?: string | null;
  validationCommands?: string[];
  branch?: string;
  prCreated: boolean;
  reflection: string;
}

const COMPACTION_THRESHOLD = 150; // lines

const MEMORY_RELATED_ARTIFACT_KINDS = new Set(["plan", "reflection", "replay", "memory", "other"]);

function countLines(content: string): number {
  return content.split("\n").length;
}

function compactContent(content: string): string {
  const lines = content.split("\n").map((line) => line.trimEnd());
  if (lines.length <= COMPACTION_THRESHOLD) return content;
  const firstSection = lines.slice(0, 20).filter(Boolean);
  const recentSection = lines.slice(-60).filter(Boolean);
  return [
    "## Compacted Memory",
    "Earlier context was compacted to keep stable facts and recent evidence.",
    "",
    ...firstSection,
    "",
    "## Recent Context",
    ...recentSection,
  ].join("\n");
}

function summarizeArtifact(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "";
  const preferredKeys = [
    "summary",
    "finalStatus",
    "validationSummary",
    "reflection",
    "qualityScore",
  ];
  const lines = preferredKeys
    .map((key) => metadata[key])
    .filter(
      (value): value is string | number => typeof value === "string" || typeof value === "number"
    )
    .map((value) => String(value));
  if (lines.length > 0) return lines.join(" | ");
  return JSON.stringify(metadata).slice(0, 400);
}

function buildTaskSummaryBlock(summary: RunMemorySummary): string {
  return [
    `### Run ${summary.runId}`,
    `- Final status: ${summary.finalStatus}`,
    `- Quality score: ${summary.qualityScore}`,
    `- Validator attempts: ${summary.validatorAttempts}`,
    `- Review blockers: ${summary.reviewBlockers}`,
    `- Review warnings: ${summary.reviewWarnings}`,
    summary.validationSummary ? `- Validation: ${summary.validationSummary}` : "",
    summary.branch ? `- Branch: ${summary.branch}` : "",
    `- Pull request created: ${summary.prCreated ? "yes" : "no"}`,
    `- Reflection: ${summary.reflection}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSharedSummaryBlock(task: Task, summary: RunMemorySummary): string {
  return [
    `### Task ${task.title}`,
    `- Outcome: ${summary.finalStatus}`,
    `- Quality: ${summary.qualityScore}`,
    `- Reflection: ${summary.reflection}`,
  ].join("\n");
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
        content: needsCompaction ? compactContent(content) : content,
        needsCompaction: false,
        compactedAt: needsCompaction
          ? (options?.compactedAt ?? new Date().toISOString())
          : existing.compactedAt,
      });
      return memory;
    } else {
      // Create new memory
      const needsCompaction = countLines(content) > COMPACTION_THRESHOLD;
      const memory = this.db.memories.create({
        taskId,
        scope,
        content: needsCompaction ? compactContent(content) : content,
        needsCompaction: false,
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
      content: compactContent(newContent),
      needsCompaction: false,
      compactedAt: new Date().toISOString(),
    });
  }

  async getRelevantContext(task: Task, limit = 6): Promise<RetrievedMemoryContext> {
    const lineage: Array<{ taskId: string; depth: number }> = [];
    let cursor: Task | null = task;
    let depth = 0;
    while (cursor && depth < 4) {
      lineage.push({ taskId: cursor.id, depth });
      cursor = cursor.parentTaskId ? this.db.tasks.getById(cursor.parentTaskId) : null;
      depth += 1;
    }

    const entries: RetrievedMemoryEntry[] = [];
    for (const item of lineage) {
      for (const scope of ["task", "shared"] as const) {
        const memory = this.db.memories.getByTaskIdAndScope(item.taskId, scope);
        if (!memory?.content.trim()) continue;
        entries.push({
          taskId: item.taskId,
          scope,
          source: "memory",
          score: (scope === "task" ? 100 : 92) - item.depth * 8,
          reason: item.depth === 0 ? `current-${scope}` : `ancestor-${scope}`,
          content: memory.content,
          updatedAt: memory.updatedAt,
        });
      }

      const artifacts = this.db.artifacts
        .listByTask(item.taskId)
        .filter((artifact) => MEMORY_RELATED_ARTIFACT_KINDS.has(artifact.kind));
      for (const artifact of artifacts) {
        const summary = summarizeArtifact(artifact.metadata);
        if (!summary) continue;
        entries.push({
          taskId: item.taskId,
          scope: "task",
          source: "artifact",
          score: 84 - item.depth * 6,
          reason: `${artifact.kind}-artifact`,
          content: `${artifact.title}: ${summary}`,
          updatedAt: artifact.createdAt,
        });
      }
    }

    const ranked = entries
      .sort(
        (left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt)
      )
      .slice(0, limit);

    const sharedMemory =
      ranked
        .filter((entry) => entry.scope === "shared")
        .map((entry) => `### ${entry.reason}\n${entry.content}`)
        .join("\n\n") || null;
    const taskMemory =
      ranked
        .filter((entry) => entry.scope === "task")
        .map((entry) => `### ${entry.reason}\n${entry.content}`)
        .join("\n\n") || null;

    return {
      sharedMemory,
      taskMemory,
      entries: ranked,
      needsCompaction: ranked.some((entry) => countLines(entry.content) > COMPACTION_THRESHOLD),
    };
  }

  async appendRunSummary(
    task: Task,
    summary: RunMemorySummary
  ): Promise<{
    sharedMemory: WorkflowMemory;
    taskMemory: WorkflowMemory;
  }> {
    const currentTaskMemory = await this.getMemory(task.id, "task");
    const currentSharedMemory = await this.getMemory(task.id, "shared");

    const taskMemory = await this.upsertMemory(
      task.id,
      "task",
      [currentTaskMemory.memory?.content?.trim(), buildTaskSummaryBlock(summary)]
        .filter(Boolean)
        .join("\n\n")
    );
    const sharedMemory = await this.upsertMemory(
      task.id,
      "shared",
      [currentSharedMemory.memory?.content?.trim(), buildSharedSummaryBlock(task, summary)]
        .filter(Boolean)
        .join("\n\n")
    );

    return { sharedMemory, taskMemory };
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
