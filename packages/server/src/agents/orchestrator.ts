import type { AgentRun, Task } from "@vibe-code/shared";
import type { Db } from "../db";
import type { GitService } from "../git/git-service";
import type { SkillsLoader } from "../skills/loader";
import type { BroadcastHub } from "../ws/broadcast";
import { executeAgent } from "./orchestrator/executor";
import { retryPR } from "./orchestrator/pr-retry";
import { logOrchestratorEvent } from "./orchestrator/terminal-logger";
import type { EngineRegistry } from "./registry";

interface ActiveRun {
  runId: string;
  taskId: string;
  engineName: string;
  abort: AbortController;
}

interface PendingRetry {
  attempt: number;
  dueAt: number;
  reason: string;
  engineOverride?: string;
  modelOverride?: string;
  timer: ReturnType<typeof setTimeout>;
}

const AUTO_RETRY_MAX = Number(process.env.VIBE_CODE_AUTO_RETRY_MAX) || 2;
const AUTO_RETRY_MAX_BACKOFF_MS =
  Number(process.env.VIBE_CODE_AUTO_RETRY_MAX_BACKOFF_MS) || 300_000;

function retryBackoffMs(attempt: number): number {
  return Math.min(10_000 * 2 ** (attempt - 1), AUTO_RETRY_MAX_BACKOFF_MS);
}

// Parse VIBE_CODE_MAX_AGENTS_BY_STATUS="in_progress:6,review:2"
function parseMaxAgentsByStatus(): Map<string, number> {
  const map = new Map<string, number>();
  const raw = process.env.VIBE_CODE_MAX_AGENTS_BY_STATUS ?? "";
  for (const entry of raw.split(",")) {
    const [status, limit] = entry.split(":");
    if (status?.trim() && limit?.trim()) {
      const n = Number(limit.trim());
      if (n > 0) map.set(status.trim().toLowerCase(), n);
    }
  }
  return map;
}

export class Orchestrator {
  private activeRuns = new Map<string, ActiveRun>();
  private retryQueue = new Map<string, PendingRetry>();
  private maxConcurrent: number;
  private maxAgentsByStatus: Map<string, number>;
  skillsLoader?: SkillsLoader;

  constructor(
    private db: Db,
    private git: GitService,
    private registry: EngineRegistry,
    public hub: BroadcastHub,
    maxConcurrent = 4
  ) {
    this.maxConcurrent = maxConcurrent;
    this.maxAgentsByStatus = parseMaxAgentsByStatus();
  }

  get activeCount(): number {
    return this.activeRuns.size;
  }

  getActiveRunEngines(): Map<string, string> {
    const result = new Map<string, string>();
    for (const [taskId, active] of this.activeRuns) {
      result.set(taskId, active.engineName);
    }
    return result;
  }

  getActiveRunDetails(): Array<{
    taskId: string;
    runId: string;
    engineName: string;
    phase: string | null;
  }> {
    return [...this.activeRuns.values()]
      .filter((a) => a.runId !== "__pending__")
      .map((active) => {
        const run = this.db.runs.getById(active.runId);
        let phase: string | null = null;
        if (run?.stateSnapshot) {
          try {
            phase = (JSON.parse(run.stateSnapshot) as { phase?: string }).phase ?? null;
          } catch {
            /* ignore */
          }
        }
        return { taskId: active.taskId, runId: active.runId, engineName: active.engineName, phase };
      });
  }

  async sweepBacklog(): Promise<void> {
    if (this.activeRuns.size >= this.maxConcurrent) return;

    // Get all tasks in backlog ordered by priority
    const backlog = this.db.tasks
      .list(undefined, "backlog")
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (const task of backlog) {
      if (this.activeRuns.size >= this.maxConcurrent) break;
      if (this.activeRuns.has(task.id)) continue;

      // Check if blocked by dependencies
      if (task.dependsOn.length > 0) {
        if (this.checkBlockedByDependencies(task.id, task.dependsOn).length > 0) continue;
      }

      try {
        await this.launch(task);
        logOrchestratorEvent(`Heartbeat: Auto-launched task "${task.title.slice(0, 40)}"`);
      } catch {
        // Fail silently during sweep - maybe engine not available or concurrency hit
      }
    }
  }

  getRetryQueueSnapshot(): Array<{
    taskId: string;
    attempt: number;
    dueInMs: number;
    reason: string;
  }> {
    return [...this.retryQueue.entries()].map(([taskId, entry]) => ({
      taskId,
      attempt: entry.attempt,
      dueInMs: Math.max(0, entry.dueAt - Date.now()),
      reason: entry.reason,
    }));
  }

  async launch(task: Task, engineOverride?: string, modelOverride?: string): Promise<AgentRun> {
    if (this.activeRuns.size >= this.maxConcurrent) {
      logOrchestratorEvent(`Max concurrent agents reached (${this.maxConcurrent})`, "warn");
      throw new Error("Max concurrent agents reached.");
    }

    // Per-status concurrency gate (VIBE_CODE_MAX_AGENTS_BY_STATUS)
    const statusLimit = this.maxAgentsByStatus.get(task.status.toLowerCase());
    if (statusLimit !== undefined) {
      const countForStatus = [...this.activeRuns.values()].filter((r) => {
        const t = this.db.tasks.getById(r.taskId);
        return t?.status === task.status;
      }).length;
      if (countForStatus >= statusLimit) {
        throw new Error(
          `Max concurrent agents for status "${task.status}" reached (${statusLimit})`
        );
      }
    }

    if (task.dependsOn.length > 0) {
      const incompleteDeps = this.checkBlockedByDependencies(task.id, task.dependsOn);
      if (incompleteDeps.length > 0) {
        const depTitles = incompleteDeps
          .map((id) => this.db.tasks.getById(id)?.title ?? id)
          .map((t) => t.slice(0, 40))
          .join(", ");
        throw new Error(`Task is blocked by incomplete dependencies: ${depTitles}`);
      }
    }

    // Cancel any pending retry for this task — it's being launched manually
    this.cancelRetry(task.id);

    // Reserve a slot immediately to prevent race conditions between concurrent launches
    const placeholder: ActiveRun = {
      runId: "__pending__",
      taskId: task.id,
      engineName: "__pending__",
      abort: new AbortController(),
    };
    this.activeRuns.set(task.id, placeholder);

    try {
      const engineName = engineOverride ?? task.engine;
      const engine =
        engineName && engineName !== "auto"
          ? this.registry.get(engineName)
          : await this.registry.getFirstAvailable();
      if (!engine) {
        if (!engineName) throw new Error("No AI engines available");
        throw new Error(`Engine "${engineName}" not found or unavailable`);
      }

      const model = modelOverride ?? task.model ?? undefined;
      const repo = this.db.repos.getById(task.repoId);
      if (!repo) throw new Error("Repository not found");
      if (repo.status === "pending")
        await this.cloneRepo(repo.id, repo.url, repo.name, repo.defaultBranch);
      else if (repo.status !== "ready") throw new Error(`Repository is in "${repo.status}" state`);

      const run = this.db.runs.create(task.id, engine.name);
      logOrchestratorEvent(
        `Launching task "${task.title.slice(0, 50)}" [${task.id.slice(0, 8)}] ` +
          `engine=${engine.name} model=${model ?? "default"} repo=${repo.name}`
      );
      this.db.tasks.update(task.id, {
        status: "in_progress",
        ...(engineOverride ? { engine: engineOverride } : {}),
        ...(model && model !== task.model ? { model } : {}),
      });
      this.hub.broadcastAll({ type: "task_updated", task: { ...task, status: "in_progress" } });

      const abort = new AbortController();
      this.activeRuns.set(task.id, {
        runId: run.id,
        taskId: task.id,
        engineName: engine.name,
        abort,
      });
      executeAgent(
        task,
        run,
        engine,
        repo,
        abort,
        this.db,
        this.git,
        this.hub,
        (c) => this.sysLog(run.id, task.id, c),
        () => {
          this.activeRuns.delete(task.id);
          this.maybeScheduleRetry(task.id, engineOverride, modelOverride);
        },
        model,
        this.skillsLoader,
        this
      ).catch((err) => {
        this.activeRuns.delete(task.id);
        console.error(`[orchestrator] Agent run failed for task ${task.id}:`, err);
      });

      return run;
    } catch (err) {
      // Release the reserved slot on any setup failure
      this.activeRuns.delete(task.id);
      throw err;
    }
  }

  async cancel(taskId: string): Promise<void> {
    // Cancel any pending auto-retry first
    this.cancelRetry(taskId);

    const active = this.activeRuns.get(taskId);
    if (!active) {
      const task = this.db.tasks.getById(taskId);
      if (task?.status === "in_progress") {
        const updated = this.db.tasks.update(taskId, { status: "backlog" });
        if (updated) this.hub.broadcastAll({ type: "task_updated", task: updated });
      }
      return;
    }

    active.abort.abort();
    const engine = this.registry.get(active.engineName);
    if (engine) engine.abort(active.runId);

    this.db.runs.updateStatus(active.runId, "cancelled", { finished_at: new Date().toISOString() });
    const task = this.db.tasks.update(taskId, { status: "backlog" });
    this.activeRuns.delete(taskId);
    if (task) this.hub.broadcastAll({ type: "task_updated", task });
    this.hub.broadcastAll({ type: "run_status", runId: active.runId, taskId, status: "cancelled" });
  }

  async retryPR(taskId: string): Promise<string> {
    return retryPR(taskId, this.db, this.git, this.registry, this.hub);
  }

  async triggerScheduled(templateTaskId: string): Promise<AgentRun> {
    const template = this.db.tasks.getById(templateTaskId);
    if (!template || template.status !== "scheduled") throw new Error("Invalid template task");

    if (this.activeRuns.size >= this.maxConcurrent) {
      throw new Error("Max concurrent agents reached — skipping scheduled trigger");
    }

    const alreadyRunning =
      this.activeRuns.has(templateTaskId) ||
      Array.from(this.activeRuns.values()).some(
        (r) => this.db.tasks.getById(r.taskId)?.parentTaskId === templateTaskId
      );
    if (alreadyRunning) throw new Error("A derived task from this template is already running");

    const derived = this.db.tasks.create({
      ...template,
      id: undefined,
      status: "backlog",
      parentTaskId: template.id,
    } as any);
    this.hub.broadcastAll({ type: "task_updated", task: derived });
    return this.launch(derived);
  }

  sendInput(taskId: string, input: string): boolean {
    const active = this.activeRuns.get(taskId);
    if (!active) return false;
    const engine = this.registry.get(active.engineName);
    if (!engine?.sendInput(active.runId, input)) return false;

    this.db.logs.create(active.runId, "stdin", input);
    this.hub.broadcastToTask(taskId, {
      type: "agent_log",
      runId: active.runId,
      taskId,
      stream: "stdin",
      content: input,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  checkBlockedByDependencies(_taskId: string, dependsOn: string[]): string[] {
    return dependsOn.filter((depId) => {
      const dep = this.db.tasks.getById(depId);
      if (!dep) return true;
      if (dep.status === "done" || dep.status === "archived" || dep.status === "failed") {
        return false;
      }
      return true;
    });
  }

  unblockDependents(completedTaskId: string): string[] {
    const blocked: string[] = [];
    const allTasks = this.db.tasks.list();
    for (const task of allTasks) {
      if (task.dependsOn.includes(completedTaskId)) {
        const stillBlocked = this.checkBlockedByDependencies(task.id, task.dependsOn);
        if (stillBlocked.length === 0 && task.status === "backlog") {
          blocked.push(task.id);
          this.hub.broadcastAll({
            type: "task_unblocked",
            taskId: task.id,
            unblockedBy: completedTaskId,
          });
        }
      }
    }
    return blocked;
  }

  private maybeScheduleRetry(
    taskId: string,
    engineOverride?: string,
    modelOverride?: string
  ): void {
    if (AUTO_RETRY_MAX <= 0) return;

    const task = this.db.tasks.getById(taskId);
    if (!task || task.status !== "failed") return;

    const existing = this.retryQueue.get(taskId);
    const attempt = (existing?.attempt ?? 0) + 1;
    if (attempt > AUTO_RETRY_MAX) return;

    const delayMs = retryBackoffMs(attempt);
    const dueAt = Date.now() + delayMs;

    const timer = setTimeout(async () => {
      this.retryQueue.delete(taskId);
      const t = this.db.tasks.getById(taskId);
      if (!t || t.status !== "failed") return;

      logOrchestratorEvent(
        `Auto-retrying task [${taskId.slice(0, 8)}] (attempt ${attempt}/${AUTO_RETRY_MAX})`
      );
      const updated = this.db.tasks.update(taskId, { status: "backlog" });
      if (updated) this.hub.broadcastAll({ type: "task_updated", task: updated });

      try {
        await this.launch({ ...t, status: "backlog" }, engineOverride, modelOverride);
      } catch (err) {
        console.error(`[orchestrator] Auto-retry launch failed for task ${taskId}:`, err);
      }
    }, delayMs);

    if (existing) clearTimeout(existing.timer);

    const run = this.db.runs.getLatestByTask(taskId);
    const reason = run?.errorMessage?.startsWith("Agent stalled") ? "stalled" : "failed";

    this.retryQueue.set(taskId, {
      attempt,
      dueAt,
      reason,
      engineOverride,
      modelOverride,
      timer,
    });

    logOrchestratorEvent(
      `Task [${taskId.slice(0, 8)}] scheduled for auto-retry ${attempt}/${AUTO_RETRY_MAX} ` +
        `in ${Math.round(delayMs / 1000)}s (reason: ${reason})`
    );
  }

  private cancelRetry(taskId: string): void {
    const entry = this.retryQueue.get(taskId);
    if (entry) {
      clearTimeout(entry.timer);
      this.retryQueue.delete(taskId);
      logOrchestratorEvent(`Auto-retry cancelled for task [${taskId.slice(0, 8)}]`);
    }
  }

  private sysLog(runId: string, taskId: string, content: string): void {
    this.db.logs.create(runId, "system", content);
    this.hub.broadcastToTask(taskId, {
      type: "agent_log",
      runId,
      taskId,
      stream: "system",
      content,
      timestamp: new Date().toISOString(),
    });
  }

  private async cloneRepo(
    repoId: string,
    url: string,
    name: string,
    _defaultBranch: string
  ): Promise<void> {
    this.db.repos.updateStatus(repoId, "cloning");
    try {
      const localPath = await this.git.cloneRepo(url, name);
      this.db.repos.updateStatus(repoId, "ready", localPath);
    } catch (err: any) {
      this.db.repos.updateStatus(repoId, "error", null, err.message || String(err));
      throw err;
    }
  }
}
