import type { AgentRun, LogStream, Task } from "@vibe-code/shared";
import type { Db } from "../db";
import type { GitService } from "../git/git-service";
import type { BroadcastHub } from "../ws/broadcast";
import type { AgentEngine, AgentEvent } from "./engine";
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

  async launch(task: Task, engineOverride?: string, modelOverride?: string): Promise<AgentRun> {
    if (this.activeRuns.size >= this.maxConcurrent) {
      throw new Error(`Max concurrent agents (${this.maxConcurrent}) reached. Try again later.`);
    }

    // Resolve engine
    const engineName = engineOverride ?? task.engine;
    let engine: AgentEngine | undefined;
    if (engineName) {
      engine = this.registry.get(engineName);
      if (!engine) throw new Error(`Engine "${engineName}" not found`);
      if (!(await engine.isAvailable())) throw new Error(`Engine "${engineName}" is not available`);
    } else {
      engine = await this.registry.getFirstAvailable();
      if (!engine) throw new Error("No AI engines available. Install claude, aider, or opencode.");
    }

    // Resolve model (override > task.model)
    const model = modelOverride ?? task.model ?? undefined;

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
    this.activeRuns.set(task.id, {
      runId: run.id,
      taskId: task.id,
      engineName: engine.name,
      abort,
    });
    this.runAgent(task, run, engine, repo, abort, model).catch((err) => {
      console.error(`[orchestrator] Agent run failed for task ${task.id}:`, err);
    });

    return run;
  }

  async cancel(taskId: string): Promise<void> {
    const active = this.activeRuns.get(taskId);
    if (!active) {
      // No active run — still reset the task status if it's stuck as in_progress
      const task = this.db.tasks.getById(taskId);
      if (task && task.status === "in_progress") {
        const updated = this.db.tasks.update(taskId, { status: "backlog" });
        if (updated) {
          this.hub.broadcastAll({ type: "task_updated", task: updated });
        }
      }
      return;
    }

    // Signal abort and kill the process via the engine
    active.abort.abort();
    const engine = this.registry.get(active.engineName);
    if (engine) {
      engine.abort(active.runId);
    }

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

  async retryPR(taskId: string): Promise<string> {
    const task = this.db.tasks.getById(taskId);
    if (!task) throw new Error("Task not found");
    if (task.status !== "review") throw new Error("Task must be in review status");
    if (!task.branchName) throw new Error("Task has no branch associated");

    const repo = this.db.repos.getById(task.repoId);
    if (!repo) throw new Error("Repository not found");

    const barePath = repo.localPath ?? this.git.getBarePath(repo.name);
    const run = this.db.runs.getLatestByTask(taskId);
    if (!run) throw new Error("No run found for this task");

    const engine = this.registry.get(run.engine);
    if (!engine) throw new Error(`Engine ${run.engine} not found`);

    // Log the attempt
    this.db.logs.create(run.id, "system", "Retrying Pull Request creation...");
    this.hub.broadcastToTask(taskId, {
      type: "agent_log",
      runId: run.id,
      taskId,
      stream: "system",
      content: "Retrying Pull Request creation...",
      timestamp: new Date().toISOString(),
    });

    // Create a temporary worktree using the task branch
    const wtId = `retry-pr-${Date.now()}`;
    const wtPath = await this.git.createWorktree(
      barePath,
      task.branchName,
      repo.name,
      wtId,
      repo.defaultBranch,
      false
    );

    try {
      // Push with -u to ensure it's tracked
      await this.git.push(wtPath, task.branchName);

      // Create PR
      const prBody = `${task.description}\n\n---\n_Created by vibe-code agent using ${engine.name}_`;
      const prUrl = await this.git.createPR(wtPath, repo.url, task.branchName, task.title, prBody);

      // Update task with PR URL
      this.db.tasks.updateField(task.id, "pr_url", prUrl);
      const updatedTask = this.db.tasks.getById(task.id);
      if (updatedTask) {
        this.hub.broadcastAll({ type: "task_updated", task: updatedTask });
      }

      this.db.logs.create(run.id, "system", `Pull Request created manually: ${prUrl}`);
      this.hub.broadcastToTask(taskId, {
        type: "agent_log",
        runId: run.id,
        taskId,
        stream: "system",
        content: `Pull Request created manually: ${prUrl}`,
        timestamp: new Date().toISOString(),
      });

      return prUrl;
    } finally {
      // Cleanup worktree
      await this.git.removeWorktree(barePath, wtPath);
    }
  }

  sendInput(taskId: string, input: string): boolean {
    const active = this.activeRuns.get(taskId);
    if (!active) return false;
    const engine = this.registry.get(active.engineName);
    if (!engine) return false;
    const sent = engine.sendInput(active.runId, input);
    if (sent) {
      // Log the user input
      this.db.logs.create(active.runId, "stdin", input);
      this.hub.broadcastToTask(taskId, {
        type: "agent_log",
        runId: active.runId,
        taskId,
        stream: "stdin" as LogStream,
        content: input,
        timestamp: new Date().toISOString(),
      });
    }
    return sent;
  }

  private async runAgent(
    task: Task,
    run: AgentRun,
    engine: ReturnType<EngineRegistry["get"]> & {},
    repo: {
      id: string;
      name: string;
      url: string;
      defaultBranch: string;
      localPath: string | null;
    },
    abort: AbortController,
    _model?: string
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
      const updatedRun = this.db.runs.updateStatus(run.id, "running", {
        started_at: new Date().toISOString(),
      });
      if (updatedRun) {
        this.hub.broadcastAll({ type: "run_updated", run: updatedRun });
      }

      // Create worktree
      wtPath = await this.git.createWorktree(
        barePath,
        branch,
        repo.name,
        run.id,
        repo.defaultBranch
      );
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

      // Commit any uncommitted changes left by the agent
      const hasChanges = await this.git.hasChanges(wtPath);
      if (hasChanges) {
        await this.git.commitAll(wtPath, `vibe-code: ${task.title}`);
      }

      // Check that the agent actually produced commits (vs base branch)
      const hasCommits = await this.git.hasCommitsAhead(wtPath, repo.defaultBranch);
      if (!hasCommits) {
        throw new Error("Agent completed but made no changes");
      }

      // Push branch and create PR
      try {
        await this.git.push(wtPath, branch);

        // Create PR
        const prBody = `${task.description}\n\n---\n_Created by vibe-code agent using ${engine.name}_`;
        const prUrl = await this.git.createPR(wtPath, repo.url, branch, task.title, prBody);

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
      } catch (pushErr) {
        // Push failed - still mark as completed but without PR
        const pushErrMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
        this.db.runs.updateStatus(run.id, "completed", {
          finished_at: new Date().toISOString(),
          exit_code: 0,
          error_message: `Push/PR failed: ${pushErrMsg}`,
        });
        this.db.tasks.updateField(task.id, "branch_name", branch);
        const updatedTask = this.db.tasks.update(task.id, { status: "review" });
        if (updatedTask) {
          this.hub.broadcastAll({ type: "task_updated", task: updatedTask });
        }
      }
    } catch (err) {
      // Agent failed
      const errMsg = err instanceof Error ? err.message : String(err);
      const updatedRun = this.db.runs.updateStatus(run.id, "failed", {
        finished_at: new Date().toISOString(),
        error_message: errMsg,
      });
      this.db.tasks.update(task.id, { status: "failed" });

      const failedTask = this.db.tasks.getById(task.id);
      if (failedTask) {
        this.hub.broadcastAll({ type: "task_updated", task: failedTask });
      }
      if (updatedRun) {
        this.hub.broadcastAll({ type: "run_updated", run: updatedRun });
      }
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
      this.hub.broadcastAll({
        type: "agent_log",
        runId,
        taskId,
        stream: (event.stream ?? "stdout") as LogStream,
        content: event.content,
        timestamp: new Date().toISOString(),
      });
    } else if (event.type === "error" && event.content) {
      // Log error but do NOT throw — let the flow continue to commit/push/PR
      this.db.logs.create(runId, "stderr", event.content);
      this.hub.broadcastAll({
        type: "agent_log",
        runId,
        taskId,
        stream: "stderr",
        content: event.content,
        timestamp: new Date().toISOString(),
      });
    } else if (event.type === "status" && event.content) {
      const run = this.db.runs.getById(runId);
      if (run) {
        const updated = this.db.runs.updateStatus(runId, run.status, {
          current_status: event.content,
        });
        if (updated) {
          this.hub.broadcastAll({ type: "run_updated", run: updated });
        }
      }
    }
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
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.db.repos.updateStatus(repoId, "error", null, errMsg);
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
