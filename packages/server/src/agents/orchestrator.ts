import type { Task, AgentRun } from "@vibe-code/shared";
import type { Db } from "../db";
import type { GitService } from "../git/git-service";
import type { EngineRegistry } from "./registry";
import type { BroadcastHub } from "../ws/broadcast";
import type { AgentEvent } from "./engine";

interface ActiveRun {
  runId: string;
  taskId: string;
  abort: AbortController;
}

export class Orchestrator {
  private activeRuns = new Map<string, ActiveRun>();
  private maxConcurrent: number;

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

  async launch(task: Task, engineOverride?: string): Promise<AgentRun> {
    if (this.activeRuns.size >= this.maxConcurrent) {
      throw new Error(`Max concurrent agents (${this.maxConcurrent}) reached. Try again later.`);
    }

    // Resolve engine
    const engineName = engineOverride ?? task.engine;
    let engine;
    if (engineName) {
      engine = this.registry.get(engineName);
      if (!engine) throw new Error(`Engine "${engineName}" not found`);
      if (!(await engine.isAvailable())) throw new Error(`Engine "${engineName}" is not available`);
    } else {
      engine = await this.registry.getFirstAvailable();
      if (!engine) throw new Error("No AI engines available. Install claude, aider, or opencode.");
    }

    // Get repo
    const repo = this.db.repos.getById(task.repoId);
    if (!repo) throw new Error("Repository not found");
    if (repo.status !== "ready") {
      // Try to clone if pending
      if (repo.status === "pending") {
        await this.cloneRepo(repo.id, repo.url, repo.name, repo.defaultBranch);
      } else {
        throw new Error(`Repository is in "${repo.status}" state`);
      }
    }

    // Create run record
    const run = this.db.runs.create(task.id, engine.name);

    // Update task status
    this.db.tasks.update(task.id, { status: "in_progress" });
    this.hub.broadcastAll({
      type: "task_updated",
      task: { ...task, status: "in_progress" },
    });

    // Launch async (don't await)
    const abort = new AbortController();
    this.activeRuns.set(task.id, { runId: run.id, taskId: task.id, abort });
    this.runAgent(task, run, engine, repo, abort).catch((err) => {
      console.error(`[orchestrator] Agent run failed for task ${task.id}:`, err);
    });

    return run;
  }

  async cancel(taskId: string): Promise<void> {
    const active = this.activeRuns.get(taskId);
    if (!active) throw new Error("No active run for this task");

    active.abort.abort();

    // Update run status
    this.db.runs.updateStatus(active.runId, "cancelled", {
      finished_at: new Date().toISOString(),
    });

    // Move task back to backlog
    const task = this.db.tasks.update(taskId, { status: "backlog" });
    this.activeRuns.delete(taskId);

    if (task) {
      this.hub.broadcastAll({ type: "task_updated", task });
    }
    this.hub.broadcastAll({
      type: "run_status",
      runId: active.runId,
      taskId,
      status: "cancelled",
    });
  }

  private async runAgent(
    task: Task,
    run: AgentRun,
    engine: ReturnType<EngineRegistry["get"]> & {},
    repo: { id: string; name: string; url: string; defaultBranch: string; localPath: string | null },
    abort: AbortController
  ): Promise<void> {
    const barePath = repo.localPath ?? (await this.git.getBarePath(repo.name));
    const slugTitle = task.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);
    const branch = `vibe-code/${run.id.slice(0, 8)}/${slugTitle}`;

    let wtPath: string | undefined;

    try {
      // Update run to running
      this.db.runs.updateStatus(run.id, "running", {
        started_at: new Date().toISOString(),
      });
      this.hub.broadcastAll({
        type: "run_status",
        runId: run.id,
        taskId: task.id,
        status: "running",
      });

      // Create worktree
      wtPath = await this.git.createWorktree(barePath, branch, repo.name, run.id, repo.defaultBranch);
      this.db.runs.updateStatus(run.id, "running", { worktree_path: wtPath });

      // Build prompt
      const prompt = buildPrompt(task);

      // Execute engine
      for await (const event of engine.execute(prompt, wtPath, {
        runId: run.id,
        signal: abort.signal,
      })) {
        if (abort.signal.aborted) break;
        await this.handleEvent(event, run.id, task.id);
      }

      if (abort.signal.aborted) return;

      // Check if there are changes to commit and push
      const hasChanges = await this.git.hasChanges(wtPath);
      if (hasChanges) {
        await this.git.commitAll(wtPath, `vibe-code: ${task.title}`);
      }

      // Check if there are commits to push (agent may have committed directly)
      try {
        await this.git.push(wtPath, branch);

        // Create PR
        const prBody = `${task.description}\n\n---\n_Created by vibe-code agent using ${engine.name}_`;
        const prUrl = await this.git.createPR(wtPath, task.title, prBody);

        // Update task with PR info
        this.db.tasks.updateField(task.id, "pr_url", prUrl);
        this.db.tasks.updateField(task.id, "branch_name", branch);
        const updatedTask = this.db.tasks.update(task.id, { status: "review" });

        this.db.runs.updateStatus(run.id, "completed", {
          finished_at: new Date().toISOString(),
          exit_code: 0,
        });

        if (updatedTask) {
          this.hub.broadcastAll({ type: "task_updated", task: updatedTask });
        }

        this.db.logs.create(run.id, "system", `PR created: ${prUrl}`);
        this.hub.broadcastToTask(task.id, {
          type: "agent_log",
          runId: run.id,
          taskId: task.id,
          stream: "system",
          content: `PR created: ${prUrl}`,
          timestamp: new Date().toISOString(),
        });
      } catch (pushErr: any) {
        // Push failed - still mark as completed but without PR
        this.db.runs.updateStatus(run.id, "completed", {
          finished_at: new Date().toISOString(),
          exit_code: 0,
          error_message: `Push/PR failed: ${pushErr.message}`,
        });
        const updatedTask = this.db.tasks.update(task.id, { status: "review" });
        if (updatedTask) {
          this.hub.broadcastAll({ type: "task_updated", task: updatedTask });
        }
      }
    } catch (err: any) {
      // Agent failed
      this.db.runs.updateStatus(run.id, "failed", {
        finished_at: new Date().toISOString(),
        error_message: err.message,
      });
      this.db.tasks.update(task.id, { status: "failed" });

      const failedTask = this.db.tasks.getById(task.id);
      if (failedTask) {
        this.hub.broadcastAll({ type: "task_updated", task: failedTask });
      }
      this.hub.broadcastAll({
        type: "run_status",
        runId: run.id,
        taskId: task.id,
        status: "failed",
      });
    } finally {
      this.activeRuns.delete(task.id);

      // Cleanup worktree
      if (wtPath) {
        try {
          await this.git.removeWorktree(barePath, wtPath);
        } catch {
          // Best effort
        }
      }
    }
  }

  private async handleEvent(event: AgentEvent, runId: string, taskId: string): Promise<void> {
    if (event.type === "log" && event.content) {
      this.db.logs.create(runId, event.stream ?? "stdout", event.content);
      this.hub.broadcastToTask(taskId, {
        type: "agent_log",
        runId,
        taskId,
        stream: (event.stream as any) ?? "stdout",
        content: event.content,
        timestamp: new Date().toISOString(),
      });
    } else if (event.type === "error" && event.content) {
      this.db.logs.create(runId, "stderr", event.content);
      this.hub.broadcastToTask(taskId, {
        type: "agent_log",
        runId,
        taskId,
        stream: "stderr",
        content: event.content,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async cloneRepo(
    repoId: string,
    url: string,
    name: string,
    defaultBranch: string
  ): Promise<void> {
    this.db.repos.updateStatus(repoId, "cloning");
    try {
      const localPath = await this.git.cloneRepo(url, name);
      this.db.repos.updateStatus(repoId, "ready", localPath);
    } catch (err: any) {
      this.db.repos.updateStatus(repoId, "error", null, err.message);
      throw err;
    }
  }
}

function buildPrompt(task: Task): string {
  let prompt = task.title;
  if (task.description) {
    prompt += `\n\n${task.description}`;
  }
  prompt += "\n\nPlease implement the changes described above. Commit your changes when done.";
  return prompt;
}
