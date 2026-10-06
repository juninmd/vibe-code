import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HARNESS_ENGINES,
  type HarnessEngine,
  type SkillEntry,
  type SkillMode,
  type SkillPlan,
  type Task,
  type TerminalSignal,
  type TerminalStartRequest,
  type TerminalState,
} from "@vibe-code/shared";
import type { EngineRegistry } from "../agents/registry";
import type { Db } from "../db";
import type { GitService } from "../git/git-service";
import type { SkillsLoader } from "../skills/loader";
import type { BroadcastHub } from "../ws/broadcast";
import {
  buildHarnessLaunch,
  type InjectableSkill,
  installAgentPlugin,
  isHarnessEngine,
  readSkillPlan,
  writeSkillPlan,
  writeTaskBrief,
} from "./harness";
import { resolveShellCommand, TerminalSessionService } from "./session-service";
import { manualPicks, planSkills, skillNames } from "./skill-plan";

export class TerminalError extends Error {
  constructor(
    readonly code: "not_found" | "bad_request" | "unavailable" | "failed",
    message: string
  ) {
    super(message);
  }
}

export interface TerminalControllerDeps {
  db: Db;
  git: GitService;
  registry: EngineRegistry;
  hub: BroadcastHub;
  skills: SkillsLoader;
}

interface LiveSession {
  runId: string;
  engine: HarnessEngine | "shell";
  cwd: string;
  plan: SkillPlan;
}

export interface SkillChoice {
  /** The operator's own list; makes the plan manual. */
  skills?: string[];
  /** `auto` hands the choice back to vibe-code. */
  mode?: SkillMode;
}

interface SkillCatalog {
  entries: SkillEntry[];
  injectable: InjectableSkill[];
}

const EMPTY_PLAN: SkillPlan = { mode: "auto", applied: [] };

const SESSION_MARKER = ".vibe-code/terminal.json";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runGit(location: string, args: string[], bare = false): Promise<string> {
  const proc = Bun.spawn(["git", ...(bare ? ["--git-dir", location] : []), ...args], {
    cwd: bare ? undefined : location,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return out.trim();
}

/**
 * Turns a kanban task into an interactive agent terminal: prepares an isolated
 * worktree, injects the chosen skills, launches Claude Code / OpenCode inside a
 * PTY and keeps the task/run records in sync with what happens in the terminal.
 */
export class TerminalController {
  readonly service: TerminalSessionService;
  private readonly live = new Map<string, LiveSession>();
  private readonly starting = new Map<string, Promise<TerminalState>>();

  constructor(private readonly deps: TerminalControllerDeps) {
    const { hub } = deps;
    const now = () => new Date().toISOString();
    this.service = new TerminalSessionService({
      onOpened: (taskId, runId, cols, rows) =>
        hub.broadcastToTask(taskId, { type: "terminal_opened", taskId, runId, cols, rows }),
      onOutput: (taskId, runId, stream, chunk) =>
        hub.broadcastToTask(taskId, {
          type: "terminal_output",
          taskId,
          runId,
          stream,
          chunk,
          timestamp: now(),
        }),
      onClosed: (taskId, runId, exitCode, reason) => {
        hub.broadcastToTask(taskId, {
          type: "terminal_closed",
          taskId,
          runId,
          exitCode,
          reason,
          timestamp: now(),
        });
        void this.finalize(taskId, runId, exitCode, reason).catch((error) => {
          console.error("[terminal] ERROR: failed to finalize terminal run", {
            taskId,
            runId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
      onError: (taskId, runId, message) =>
        hub.broadcastToTask(taskId, {
          type: "terminal_output",
          taskId,
          runId,
          stream: "stderr",
          chunk: `\r\n[terminal error] ${message}\r\n`,
          timestamp: now(),
        }),
    });
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  async state(taskId: string): Promise<TerminalState> {
    const live = this.live.get(taskId);
    if (live && this.service.isOpen(taskId)) {
      return {
        taskId,
        live: true,
        runId: live.runId,
        engine: live.engine,
        skills: skillNames(live.plan),
        applied: live.plan.applied,
        skillMode: live.plan.mode,
        cwd: live.cwd,
      };
    }

    const run = this.deps.db.runs.getLatestByTask(taskId);
    const cwd = run?.worktreePath && (await pathExists(run.worktreePath)) ? run.worktreePath : null;
    const plan = (cwd ? await readSkillPlan(cwd) : null) ?? EMPTY_PLAN;
    return {
      taskId,
      live: false,
      runId: run?.id ?? null,
      engine: isHarnessEngine(run?.engine) ? run.engine : null,
      skills: skillNames(plan),
      applied: plan.applied,
      skillMode: plan.mode,
      cwd,
    };
  }

  /**
   * The skills a task gets when started now, before any workspace exists. Lets the UI show
   * what will be applied (and why) instead of asking the operator to pick blindly.
   */
  async previewSkills(taskId: string, choice: SkillChoice = {}): Promise<SkillPlan> {
    const task = this.requireTask(taskId);
    const { cwd } = await this.state(taskId);
    const { entries } = await this.loadSkills();
    return this.resolvePlan(task, cwd, entries, choice);
  }

  /** Rendered screen to restore on a client that (re)attaches to a live session. */
  snapshotTo(taskId: string, deliver: (snapshot: string) => void): boolean {
    return this.service.snapshotTo(taskId, deliver);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /** Start (or return the already running) terminal session of a task. */
  start(taskId: string, request: TerminalStartRequest = {}): Promise<TerminalState> {
    const pending = this.starting.get(taskId);
    if (pending) return pending;
    const promise = this.doStart(taskId, request).finally(() => this.starting.delete(taskId));
    this.starting.set(taskId, promise);
    return promise;
  }

  stop(taskId: string): boolean {
    return this.service.closeSession(taskId);
  }

  input(taskId: string, data: string) {
    return this.service.sendInput(taskId, data);
  }

  resize(taskId: string, cols: number, rows: number): boolean {
    return this.service.resize(taskId, cols, rows);
  }

  signal(taskId: string, signal: TerminalSignal): boolean {
    return this.service.signal(taskId, signal);
  }

  /** Change the skills of the task's agent plugin (applies when the session next starts). */
  async setSkills(taskId: string, choice: SkillChoice): Promise<TerminalState> {
    const task = this.requireTask(taskId);
    const current = await this.state(taskId);
    if (!current.cwd) {
      throw new TerminalError("bad_request", "Start the task terminal before choosing skills");
    }
    const engine =
      current.engine && current.engine !== "shell" ? current.engine : this.pickDefaultEngine(task);
    const { entries, injectable } = await this.loadSkills();
    const plan = await this.resolvePlan(task, current.cwd, entries, choice);
    const installed = await installAgentPlugin(current.cwd, engine, skillNames(plan), injectable);
    const applied = plan.applied.filter(
      (skill) => !installed.missing.includes(skill.name) || skill.source === "manual"
    );
    const finalPlan: SkillPlan = { mode: plan.mode, applied };
    await writeSkillPlan(current.cwd, finalPlan);
    if (current.runId) this.deps.db.runs.updateMatchedSkills(current.runId, skillNames(finalPlan));
    const live = this.live.get(taskId);
    if (live) live.plan = finalPlan;
    return {
      ...current,
      engine,
      skills: skillNames(finalPlan),
      applied: finalPlan.applied,
      skillMode: finalPlan.mode,
    };
  }

  /**
   * Commit what the agent produced and move the task to review, ready for
   * "Create PR". Closes the terminal if it is still running.
   */
  async finish(taskId: string): Promise<Task> {
    const task = this.requireTask(taskId);
    const current = await this.state(taskId);
    if (!current.cwd) throw new TerminalError("bad_request", "This task has no workspace yet");

    await this.deps.git.commitAll(current.cwd, `feat: ${task.title}`);
    this.service.closeSession(taskId);
    // closeSession finalizes asynchronously; make the outcome deterministic.
    const updated = this.deps.db.tasks.updateField(taskId, "status", "review");
    if (!updated) throw new TerminalError("not_found", "Task not found");
    this.deps.hub.broadcastAll({ type: "task_updated", task: updated });
    return updated;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private requireTask(taskId: string): Task {
    const task = this.deps.db.tasks.getById(taskId);
    if (!task) throw new TerminalError("not_found", "Task not found");
    return task;
  }

  private pickDefaultEngine(task: Task): HarnessEngine {
    return isHarnessEngine(task.engine) ? task.engine : HARNESS_ENGINES[0];
  }

  private async loadSkills(): Promise<SkillCatalog> {
    try {
      const index = await this.deps.skills.load();
      const injectable: InjectableSkill[] = [];
      for (const skill of index.skills) {
        if (!skill.filePath) continue;
        if (skill.filePath.startsWith("virtual://")) {
          const file = await this.materializeVirtualSkill(
            skill.name,
            skill.description,
            skill.filePath
          );
          if (file) injectable.push({ name: skill.name, filePath: file });
        } else {
          injectable.push({ name: skill.name, filePath: skill.filePath });
        }
      }
      return { entries: index.skills, injectable };
    } catch {
      return { entries: [], injectable: [] };
    }
  }

  /**
   * Manual until the operator says otherwise: an explicit list wins, then a manual plan
   * stored with the workspace, and everything else is picked from the task text.
   */
  private async resolvePlan(
    task: Task,
    cwd: string | null,
    entries: SkillEntry[],
    choice: SkillChoice
  ): Promise<SkillPlan> {
    let manual: string[] | null = null;
    if (choice.skills) {
      manual = choice.skills;
    } else if (choice.mode !== "auto") {
      const stored = cwd ? await readSkillPlan(cwd) : null;
      if (stored?.mode === "manual") manual = manualPicks(stored.applied);
    }
    return planSkills({
      skills: entries,
      title: task.title,
      description: task.description,
      goal: task.goal,
      manual,
    });
  }

  /** Built-in skills (e.g. the board orchestrator) have no folder: write one on demand. */
  private async materializeVirtualSkill(
    name: string,
    description: string,
    filePath: string
  ): Promise<string | null> {
    try {
      const body = await this.deps.skills.getFileContent(filePath);
      const dir = join(tmpdir(), "vibe-code-virtual-skills", name);
      await mkdir(dir, { recursive: true });
      const file = join(dir, "SKILL.md");
      const safeDescription = description.replace(/\s+/g, " ").trim();
      await writeFile(
        file,
        `---\nname: ${name}\ndescription: ${safeDescription}\n---\n${body}`,
        "utf8"
      );
      return file;
    } catch {
      return null;
    }
  }

  /** Environment that lets the agent talk back to the board (sub-tasks, etc.). */
  private harnessEnv(task: Task, runId: string): Record<string, string> {
    return {
      VIBE_CODE_API_URL: `http://localhost:${process.env.PORT || 3000}`,
      VIBE_CODE_TASK_ID: task.id,
      VIBE_CODE_RUN_ID: runId,
      VIBE_CODE_REPO_ID: task.repoId,
      VIBE_CODE_PARENT_TASK_ID: task.id,
    };
  }

  private async resolveEngine(task: Task, requested?: HarnessEngine): Promise<HarnessEngine> {
    const candidates = requested
      ? [requested]
      : [this.pickDefaultEngine(task), ...HARNESS_ENGINES.filter((e) => e !== task.engine)];
    for (const name of candidates) {
      const engine = this.deps.registry.get(name);
      if (engine && (await engine.isAvailable())) return name;
    }
    const wanted = requested ?? "Claude Code or OpenCode";
    throw new TerminalError(
      "unavailable",
      `${wanted} is not installed on the server. Install the CLI and try again.`
    );
  }

  /** Reuse the workspace of a previous run, or create a fresh worktree + branch. */
  private async prepareWorkspace(task: Task, runId: string): Promise<string> {
    const { db, git } = this.deps;
    // Newest first. Any earlier run may still own the branch's checkout, and a headless
    // run's workspace is removed when it ends, so look past the most recent one.
    for (const run of db.runs.listByTask(task.id)) {
      if (run.id !== runId && run.worktreePath && (await pathExists(run.worktreePath))) {
        return run.worktreePath;
      }
    }

    const repo = db.repos.getById(task.repoId);
    if (!repo) throw new TerminalError("not_found", "Repository not found");
    if (repo.status === "error") {
      throw new TerminalError("failed", repo.errorMessage ?? "Repository failed to clone");
    }

    const barePath = repo.localPath ?? (await git.getBarePath(repo.name, repo.url));
    // Worktrees deleted from disk (cleanup, manual removal) still lock their branch
    // until git forgets them.
    await runGit(barePath, ["worktree", "prune"], true).catch(() => {});

    const slug = task.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    const branch = task.branchName ?? `vibe-code/${runId.slice(0, 8)}/${slug || "task"}`;
    const worktree = await git.createWorktree(
      barePath,
      branch,
      repo.name,
      runId,
      task.baseBranch || repo.defaultBranch,
      !task.branchName
    );
    if (!task.branchName) db.tasks.updateField(task.id, "branch_name", branch);
    return worktree;
  }

  private async doStart(taskId: string, request: TerminalStartRequest): Promise<TerminalState> {
    const { db, hub } = this.deps;
    if (this.service.isOpen(taskId)) {
      this.service.openSession({ taskId, runId: this.live.get(taskId)?.runId ?? null });
      return this.state(taskId);
    }

    const task = this.requireTask(taskId);
    const shell = request.engine === "shell";
    const engine = shell
      ? this.pickDefaultEngine(task)
      : await this.resolveEngine(task, request.engine as HarnessEngine | undefined);
    // A shell session is recorded under the task's harness so "Create PR" keeps working.
    const run = db.runs.create(taskId, engine);

    let cwd: string;
    try {
      cwd = await this.prepareWorkspace(task, run.id);
    } catch (error) {
      db.runs.updateStatus(run.id, "failed", {
        finished_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof TerminalError
        ? error
        : new TerminalError("failed", error instanceof Error ? error.message : String(error));
    }

    let launch: { argv: string[]; env: Record<string, string> };
    let plan: SkillPlan = EMPTY_PLAN;
    if (shell) {
      launch = {
        argv: resolveShellCommand(),
        env: this.harnessEnv(task, run.id),
      };
    } else {
      const resume = await this.canResume(cwd, engine);
      await writeTaskBrief(cwd, task);
      const { entries, injectable } = await this.loadSkills();
      const wanted = await this.resolvePlan(task, cwd, entries, {
        skills: request.skills,
        mode: request.skillMode,
      });
      const installed = await installAgentPlugin(cwd, engine, skillNames(wanted), injectable);
      plan = {
        mode: wanted.mode,
        applied: wanted.applied.filter(
          (skill) => !installed.missing.includes(skill.name) || skill.source === "manual"
        ),
      };
      await writeSkillPlan(cwd, plan);

      launch = buildHarnessLaunch({
        engine,
        task,
        model: request.model ?? task.model ?? undefined,
        resume,
        pluginDir: installed.pluginDir,
        apiKeys: {
          anthropic: db.settings.get("anthropic_api_key") || undefined,
          openai: db.settings.get("openai_api_key") || undefined,
          gemini: db.settings.get("gemini_api_key") || undefined,
        },
        env: this.harnessEnv(task, run.id),
      });
    }

    db.runs.updateStatus(run.id, "running", {
      started_at: new Date().toISOString(),
      worktree_path: cwd,
      current_status: "terminal",
    });
    db.runs.updateMatchedSkills(run.id, skillNames(plan));
    this.live.set(taskId, {
      runId: run.id,
      engine: shell ? "shell" : engine,
      cwd,
      plan,
    });
    if (!shell) {
      await writeFile(join(cwd, SESSION_MARKER), JSON.stringify({ engine, runId: run.id }), "utf8");
    }

    const opened = this.service.openSession({
      taskId,
      runId: run.id,
      cwd,
      cols: request.cols,
      rows: request.rows,
      command: launch.argv,
      env: launch.env,
    });
    if (!opened) {
      this.live.delete(taskId);
      db.runs.updateStatus(run.id, "failed", {
        finished_at: new Date().toISOString(),
        error_message: `Could not start ${launch.argv[0]}`,
      });
      throw new TerminalError("failed", `Could not start ${launch.argv[0]}`);
    }

    const started = db.tasks.updateField(taskId, "status", "in_progress");
    if (started) hub.broadcastAll({ type: "task_updated", task: started });
    const runRow = db.runs.getById(run.id);
    if (runRow) hub.broadcastAll({ type: "run_updated", run: runRow });
    return this.state(taskId);
  }

  /** A workspace can resume the previous conversation when the same harness ran in it. */
  private async canResume(cwd: string, engine: HarnessEngine): Promise<boolean> {
    try {
      const marker = JSON.parse(await readFile(join(cwd, SESSION_MARKER), "utf8")) as {
        engine?: string;
      };
      return marker.engine === engine;
    } catch {
      return false;
    }
  }

  /** Keep run + task records honest once the PTY is gone. */
  private async finalize(
    taskId: string,
    runId: string | null,
    exitCode: number | null,
    reason: "exit" | "closed"
  ): Promise<void> {
    const { db, hub } = this.deps;
    const session = this.live.get(taskId);
    this.live.delete(taskId);
    if (!runId) return;

    const userClosed = reason === "closed";
    const ok = userClosed || exitCode === 0;
    db.runs.updateStatus(runId, userClosed ? "cancelled" : ok ? "completed" : "failed", {
      finished_at: new Date().toISOString(),
      exit_code: exitCode,
      error_message: ok ? null : `Terminal exited with code ${exitCode ?? "unknown"}`,
    });

    const task = db.tasks.getById(taskId);
    if (task?.status !== "in_progress") {
      const run = db.runs.getById(runId);
      if (run) hub.broadcastAll({ type: "run_updated", run });
      return;
    }

    const worked = session ? await this.workspaceHasWork(session.cwd, task) : true;
    const nextStatus = !ok ? "failed" : worked ? "review" : "backlog";
    const updated = db.tasks.updateField(taskId, "status", nextStatus);
    if (updated) hub.broadcastAll({ type: "task_updated", task: updated });
    const run = db.runs.getById(runId);
    if (run) hub.broadcastAll({ type: "run_updated", run });
  }

  private async workspaceHasWork(cwd: string, task: Task): Promise<boolean> {
    try {
      if ((await runGit(cwd, ["status", "--porcelain"])).length > 0) return true;
      const repo = this.deps.db.repos.getById(task.repoId);
      const base = task.baseBranch || repo?.defaultBranch || "main";
      const ahead = await runGit(cwd, ["rev-list", "--count", `origin/${base}..HEAD`]);
      return Number(ahead) > 0;
    } catch {
      // When in doubt, let the operator look at it.
      return true;
    }
  }
}
