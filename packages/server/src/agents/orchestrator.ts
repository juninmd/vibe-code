import type { AgentRun, LogStream, Task } from "@vibe-code/shared";
import type { Db } from "../db";
import type { GitService } from "../git/git-service";
import type { BroadcastHub } from "../ws/broadcast";
import type { AgentEngine, AgentEvent } from "./engine";
import { PERSONA_LABELS, type ReviewPersona, runPersonaReview } from "./engines/reviewer";
import type { EngineRegistry } from "./registry";

const ALL_PERSONAS: ReviewPersona[] = ["frontend", "backend", "security", "quality"];
const REVIEW_ENABLED = process.env.VIBE_CODE_REVIEW_ENABLED !== "false";
// Set VIBE_CODE_REVIEW_STRICT=true to block PR on review failures (default: advisory only)
const REVIEW_STRICT = process.env.VIBE_CODE_REVIEW_STRICT === "true";

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

  /** Returns a Map<taskId, engineName> for all currently running tasks */
  getActiveRunEngines(): Map<string, string> {
    const result = new Map<string, string>();
    for (const [taskId, active] of this.activeRuns) {
      result.set(taskId, active.engineName);
    }
    return result;
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

    // Update task status (and persist engine/model overrides if provided)
    this.db.tasks.update(task.id, {
      status: "in_progress",
      ...(engineOverride ? { engine: engineOverride } : {}),
      ...(model && model !== task.model ? { model } : {}),
    });
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

  async triggerScheduled(templateTaskId: string): Promise<AgentRun> {
    const template = this.db.tasks.getById(templateTaskId);
    if (!template) throw new Error("Template task not found");
    if (template.status !== "scheduled") throw new Error("Task is not a scheduled template");

    // Skip if a derived task from this template is already in_progress
    const alreadyRunning =
      this.activeRuns.has(templateTaskId) ||
      Array.from(this.activeRuns.values()).some((r) => {
        const t = this.db.tasks.getById(r.taskId);
        return t?.parentTaskId === templateTaskId;
      });
    if (alreadyRunning) throw new Error("A derived task from this template is already running");

    // Create derived task with same data as template
    const derived = this.db.tasks.create({
      title: template.title,
      description: template.description,
      repoId: template.repoId,
      engine: template.engine ?? undefined,
      model: template.model ?? undefined,
      priority: template.priority,
      status: "backlog",
      parentTaskId: template.id,
    });

    this.hub.broadcastAll({ type: "task_updated", task: derived });

    return this.launch(derived);
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
    model?: string
  ): Promise<void> {
    const barePath = repo.localPath ?? (await this.git.getBarePath(repo.name));
    const slugTitle = task.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);
    const branch = `vibe-code/${run.id.slice(0, 8)}/${slugTitle}`;

    // Agent timeout — default 2 hours, override with env var
    // Also enforce max heartbeat silence: if no activity for 5 mins, assume hung and timeout
    const TIMEOUT_MS = Number(process.env.VIBE_CODE_AGENT_TIMEOUT_MS) || 2 * 60 * 60 * 1000;
    const MAX_HEARTBEAT_SILENCE = 5 * 60 * 1000; // 5 minutes
    let timedOut = false;
    let lastActivity = Date.now();

    const timeoutId = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, TIMEOUT_MS);

    // Monitor for heartbeat silence (stalled agent detection)
    const activityMonitorId = setInterval(() => {
      const silent = Date.now() - lastActivity;
      if (silent > MAX_HEARTBEAT_SILENCE) {
        console.warn(
          `[orchestrator] Task ${task.id}: agent hung (no activity for ${Math.round(silent / 1000)}s)`
        );
        timedOut = true;
        abort.abort();
        clearInterval(activityMonitorId);
      }
    }, 30 * 1000); // Check every 30s

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
      this.sysLog(run.id, task.id, "Setting up workspace...");
      wtPath = await this.git.createWorktree(
        barePath,
        branch,
        repo.name,
        run.id,
        task.baseBranch || repo.defaultBranch
      );
      this.db.runs.updateStatus(run.id, "running", { worktree_path: wtPath });

      // Build prompt
      const prompt = buildPrompt(task);

      // Execute engine
      for await (const event of engine.execute(prompt, wtPath, {
        runId: run.id,
        signal: abort.signal,
        model: model ?? undefined,
      })) {
        if (abort.signal.aborted) break;
        await this.handleEvent(event, run.id, task.id, () => {
          lastActivity = Date.now();
        });
      }

      if (abort.signal.aborted) {
        throw new Error(
          timedOut ? `Agent timed out after ${Math.round(TIMEOUT_MS / 60000)} minutes` : "Cancelled"
        );
      }

      // Commit any uncommitted changes left by the agent
      const hasChanges = await this.git.hasChanges(wtPath);
      if (hasChanges) {
        this.sysLog(run.id, task.id, "Committing changes...");
        await this.git.commitAll(wtPath, `vibe-code: ${task.title}`);
      }

      // Check that the agent actually produced commits (vs base branch)
      const hasCommits = await this.git.hasCommitsAhead(wtPath, repo.defaultBranch);
      if (!hasCommits) {
        throw new Error("Agent completed but made no changes");
      }

      // ── Review pipeline ────────────────────────────────────────────────────
      if (REVIEW_ENABLED) {
        const blockers = await this.runReviewPipeline(task, run, wtPath, repo.defaultBranch);
        if (blockers.length > 0 && REVIEW_STRICT) {
          throw new Error(
            `Review pipeline found ${blockers.length} blocker(s):\n${blockers.join("\n")}`
          );
        } else if (blockers.length > 0) {
          this.sysLog(
            run.id,
            task.id,
            `⚠ Review found ${blockers.length} issue(s) — proceeding (non-strict mode)`
          );
        }
      }

      // Push branch and create PR
      try {
        this.sysLog(run.id, task.id, "Pushing branch to origin...");
        await this.git.push(wtPath, branch);

        this.sysLog(run.id, task.id, "Creating Pull Request...");
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

        this.sysLog(run.id, task.id, `PR created: ${prUrl}`);
      } catch (pushErr) {
        // Push/PR failed — task still moves to review so the user can retry the PR
        const pushErrMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
        this.sysLog(run.id, task.id, `Push/PR failed: ${pushErrMsg}`);
        this.db.runs.updateStatus(run.id, "completed", {
          finished_at: new Date().toISOString(),
          exit_code: 1,
          error_message: `Push/PR failed: ${pushErrMsg}`,
        });
        this.db.tasks.updateField(task.id, "branch_name", branch);
        const updatedTask = this.db.tasks.update(task.id, { status: "review" });
        if (updatedTask) {
          this.hub.broadcastAll({ type: "task_updated", task: updatedTask });
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Distinguish timeout/cancel from real failures
      const isCancelled = !timedOut && abort.signal.aborted;
      if (!isCancelled) {
        this.sysLog(run.id, task.id, `Failed: ${errMsg}`);
      }
      const updatedRun = this.db.runs.updateStatus(run.id, "failed", {
        finished_at: new Date().toISOString(),
        error_message: errMsg,
      });
      this.db.tasks.update(task.id, { status: isCancelled ? "backlog" : "failed" });

      const finalTask = this.db.tasks.getById(task.id);
      if (finalTask) {
        this.hub.broadcastAll({ type: "task_updated", task: finalTask });
      }
      if (updatedRun) {
        this.hub.broadcastAll({ type: "run_updated", run: updatedRun });
      }
    } finally {
      clearTimeout(timeoutId);
      clearInterval(activityMonitorId);
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

  /** Broadcast and persist a system log line. */
  private sysLog(runId: string, taskId: string, content: string): void {
    this.db.logs.create(runId, "system", content);
    this.hub.broadcastToTask(taskId, {
      type: "agent_log",
      runId,
      taskId,
      stream: "system" as LogStream,
      content,
      timestamp: new Date().toISOString(),
    });
  }

  private async handleEvent(
    event: AgentEvent,
    runId: string,
    taskId: string,
    onActivity?: () => void
  ): Promise<void> {
    // Record any activity (log, error, status)
    if (
      (event.type === "log" || event.type === "error" || event.type === "status") &&
      event.content
    ) {
      onActivity?.();
    }

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

  /**
   * Run 4 specialized review agents (frontend, backend, security, quality) in parallel.
   * Returns an array of BLOCKER messages. Empty array means all reviews passed.
   */
  private async runReviewPipeline(
    task: Task,
    run: AgentRun,
    wtPath: string,
    defaultBranch: string
  ): Promise<string[]> {
    this.sysLog(run.id, task.id, "Starting review pipeline (4 agents)...");

    const results = await Promise.all(
      ALL_PERSONAS.map((persona) =>
        runPersonaReview({
          persona,
          worktreePath: wtPath,
          taskTitle: task.title,
          taskDescription: task.description,
          defaultBranch,
        })
      )
    );

    const blockers: string[] = [];

    for (const result of results) {
      const label = PERSONA_LABELS[result.persona];
      const header = `[REVIEW:${result.persona}] ${label} Review`;
      const separator = "─".repeat(50);

      // Log header + content as review stream
      this.reviewLog(run.id, task.id, `${header}\n${separator}`);
      for (const line of result.content.split("\n")) {
        this.reviewLog(run.id, task.id, line);
      }
      this.reviewLog(run.id, task.id, separator);

      if (result.hasBlocker) {
        const blockerLines = result.content
          .split("\n")
          .filter((l) => l.startsWith("BLOCKER:"))
          .map((l) => `[${label}] ${l}`);
        blockers.push(...blockerLines);
      }
    }

    if (blockers.length === 0) {
      this.sysLog(run.id, task.id, "Review pipeline passed — no blockers found.");
    } else {
      this.sysLog(run.id, task.id, `Review pipeline failed — ${blockers.length} blocker(s) found.`);
    }

    return blockers;
  }

  /** Broadcast and persist a review log line. */
  private reviewLog(runId: string, taskId: string, content: string): void {
    this.db.logs.create(runId, "review", content);
    this.hub.broadcastToTask(taskId, {
      type: "agent_log",
      runId,
      taskId,
      stream: "review" as LogStream,
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
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.db.repos.updateStatus(repoId, "error", null, errMsg);
      throw err;
    }
  }
}

function buildPrompt(task: Task): string {
  const lines: string[] = [];
  lines.push(`# ${task.title}`);
  if (task.description?.trim()) {
    lines.push(`## Requirements\n${task.description.trim()}`);
  }
  lines.push(
    "## Instructions\n" +
      "Implement ALL requirements listed above exactly as described. " +
      "Create, edit, or delete files as needed — including full file content when asked to create a file. " +
      "Do not ask clarifying questions. Commit your changes when done."
  );
  return lines.join("\n\n");
}
