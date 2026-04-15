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

export class Orchestrator {
  private activeRuns = new Map<string, ActiveRun>();
  private maxConcurrent: number;
  skillsLoader?: SkillsLoader;

  constructor(
    private db: Db,
    private git: GitService,
    private registry: EngineRegistry,
    private hub: BroadcastHub,
    maxConcurrent = 4
  ) {
    this.maxConcurrent = maxConcurrent;
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

  async launch(task: Task, engineOverride?: string, modelOverride?: string): Promise<AgentRun> {
    if (this.activeRuns.size >= this.maxConcurrent) {
      logOrchestratorEvent(`Max concurrent agents reached (${this.maxConcurrent})`, "warn");
      throw new Error("Max concurrent agents reached.");
    }

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
      const engine = engineName
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
        () => this.activeRuns.delete(task.id),
        model,
        this.skillsLoader
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
