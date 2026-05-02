import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiffFileSummary, DiffSummary, TaskWithRun } from "@vibe-code/shared";
import { Cron } from "croner";
import { Hono } from "hono";
import { z } from "zod";
import type { Orchestrator } from "../agents/orchestrator";
import type { Db } from "../db";
import type { GitService } from "../git/git-service";

function computeNextRun(expression: string): string | null {
  try {
    return new Cron(expression).nextRun()?.toISOString() ?? null;
  } catch {
    return null;
  }
}

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  repoId: z.string().min(1),
  engine: z.string().optional(),
  model: z.string().optional(),
  baseBranch: z.string().optional(),
  priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
  tags: z.array(z.string()).optional(),
  agentId: z.string().optional(),
  workflowId: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  goal: z.string().optional(),
  desiredOutcome: z.string().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z
    .enum(["scheduled", "backlog", "in_progress", "review", "done", "failed", "archived"])
    .optional(),
  columnOrder: z.number().optional(),
  engine: z.string().optional(),
  model: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  goal: z.string().nullable().optional(),
  desiredOutcome: z.string().nullable().optional(),
  dependsOn: z.array(z.string()).optional(),
  pendingApproval: z.boolean().optional(),
  priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
});

const launchTaskSchema = z.object({
  engine: z.string().optional(),
  model: z.string().optional(),
});

const importIssuesSchema = z.object({
  repoId: z.string().min(1),
  issues: z
    .array(
      z.object({
        id: z.string(),
        number: z.number(),
        title: z.string(),
        body: z.string().nullable(),
        labels: z.array(z.string()),
        url: z.string(),
      })
    )
    .min(1),
  autoLabel: z.string().optional(),
});

export function createTasksRouter(db: Db, orchestrator: Orchestrator, git?: GitService) {
  const router = new Hono();

  function mapTasksWithRuns(repoId?: string, status?: string): TaskWithRun[] {
    const tasks = db.tasks.list(repoId, status);
    const latestRunsByTaskId = new Map(
      db.runs.listLatestByTaskIds(tasks.map((task) => task.id)).map((run) => [run.taskId, run])
    );
    const reposById = new Map(
      db.repos
        .listByIds(Array.from(new Set(tasks.map((task) => task.repoId))))
        .map((repo) => [repo.id, repo])
    );
    return tasks.map((task) => ({
      ...task,
      latestRun: latestRunsByTaskId.get(task.id) ?? undefined,
      repo: reposById.get(task.repoId) ?? undefined,
    }));
  }

  router.get("/", (c) => {
    const repoId = c.req.query("repo_id");
    const status = c.req.query("status");
    return c.json({ data: mapTasksWithRuns(repoId, status) });
  });

  router.get("/schedules", (c) => {
    const schedules = db.schedules.listAll();
    const tasks = mapTasksWithRuns();
    const scheduleData = schedules
      .map((schedule) => {
        const task = tasks.find((t) => t.id === schedule.taskId);
        return { schedule, task };
      })
      .filter((s) => !!s.task);
    return c.json({ data: scheduleData });
  });

  router.get("/poll", (c) => {
    const repoId = c.req.query("repo_id");
    const focusedTaskId = c.req.query("focused_task_id") ?? undefined;
    const focusedLogsAfterIdRaw = c.req.query("focused_logs_after_id") ?? "0";
    const focusedLogsAfterId = Number.parseInt(focusedLogsAfterIdRaw, 10);

    const tasks = mapTasksWithRuns(repoId);
    let focusedTask: TaskWithRun | null = null;
    let focusedLogs: ReturnType<typeof db.logs.listByRun> = [];

    if (focusedTaskId) {
      focusedTask = tasks.find((task) => task.id === focusedTaskId) ?? null;
      if (focusedTask?.latestRun?.id) {
        focusedLogs = db.logs.listByRunAfter(
          focusedTask.latestRun.id,
          Number.isNaN(focusedLogsAfterId) ? 0 : focusedLogsAfterId,
          400
        );
      }
    }

    return c.json({
      data: {
        tasks,
        focusedTask,
        focusedLogs,
        serverTime: new Date().toISOString(),
      },
    });
  });

  router.post("/archive-done", (c) => {
    const repoId = c.req.query("repo_id");
    const count = db.tasks.archiveDone(repoId);
    return c.json({ data: { archived: count } });
  });

  router.post("/clear-failed", (c) => {
    const repoId = c.req.query("repo_id");
    const count = db.tasks.clearFailed(repoId);
    return c.json({ data: { deleted: count } });
  });

  router.post("/retry-failed", async (c) => {
    const repoId = c.req.query("repo_id");
    const failedTasks = db.tasks.list(repoId, "failed");
    let count = 0;
    for (const task of failedTasks) {
      try {
        await orchestrator.launch(task);
        count++;
      } catch (_err) {
        /* ignore individual failures */
      }
    }
    return c.json({ data: { retried: count } });
  });

  router.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }

    const repo = db.repos.getById(parsed.data.repoId);
    if (!repo) {
      return c.json({ error: "not_found", message: "Repository not found" }, 404);
    }

    const task = db.tasks.create(parsed.data);
    return c.json({ data: task }, 201);
  });

  // POST /tasks/bulk/from-issues — create multiple tasks from GitHub/GitLab issues
  router.post("/bulk/from-issues", async (c) => {
    const body = await c.req.json();
    const parsed = importIssuesSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }

    const repo = db.repos.getById(parsed.data.repoId);
    if (!repo) {
      return c.json({ error: "not_found", message: "Repository not found" }, 404);
    }

    const created: { id: string; title: string; number: number }[] = [];
    for (const issue of parsed.data.issues) {
      const tags = [...(parsed.data.autoLabel ? [parsed.data.autoLabel] : []), ...issue.labels];
      const description = [issue.body ?? "", "", `---`, `Original issue: ${issue.url}`]
        .filter(Boolean)
        .join("\n");

      const task = db.tasks.create({
        title: issue.title,
        description,
        repoId: parsed.data.repoId,
        tags: tags.length > 0 ? tags : undefined,
        issueUrl: issue.url,
      });
      created.push({ id: task.id, title: task.title, number: issue.number });
    }

    return c.json({ data: { created, count: created.length } }, 201);
  });

  router.get("/:id", (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);
    const latestRun = db.runs.getLatestByTask(task.id);
    const repo = db.repos.getById(task.repoId);
    return c.json({
      data: { ...task, latestRun: latestRun ?? undefined, repo: repo ?? undefined },
    });
  });

  router.patch("/:id", async (c) => {
    const body = await c.req.json();
    const parsed = updateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }

    const task = db.tasks.update(c.req.param("id"), parsed.data);
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);
    return c.json({ data: task });
  });

  router.delete("/:id", (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);
    db.tasks.remove(c.req.param("id"));
    return c.json({ data: { ok: true } });
  });

  router.post("/:id/clone", async (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);
    const cloned = db.tasks.create({
      title: `${task.title} (copy)`,
      description: task.description,
      repoId: task.repoId,
      engine: task.engine ?? undefined,
      model: task.model ?? undefined,
      baseBranch: task.baseBranch ?? undefined,
      priority: task.priority,
      tags: task.tags,
    });
    return c.json({ data: cloned }, 201);
  });

  router.post("/:id/launch", async (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);

    if (task.status !== "backlog" && task.status !== "failed") {
      return c.json(
        { error: "invalid_state", message: `Cannot launch task in "${task.status}" status` },
        400
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = launchTaskSchema.safeParse(body);
    const engineOverride = parsed.success ? parsed.data.engine : undefined;
    const modelOverride = parsed.success ? parsed.data.model : undefined;

    try {
      const run = await orchestrator.launch(task, engineOverride, modelOverride);
      return c.json({ data: run }, 202);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "launch_failed", message: msg }, 500);
    }
  });

  router.post("/:id/cancel", async (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);

    try {
      await orchestrator.cancel(task.id);
      return c.json({ data: { ok: true } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "cancel_failed", message: msg }, 500);
    }
  });

  router.post("/:id/approve/request", async (c) => {
    const taskId = c.req.param("id");
    const { message, command } = await c.req.json();
    const details = JSON.stringify({ message, command, requestedAt: new Date().toISOString() });

    db.tasks.update(taskId, { pendingApproval: true, notes: details });
    const task = db.tasks.getById(taskId);
    if (task) {
      orchestrator.hub.broadcastAll({ type: "task_updated", task });
      orchestrator.hub.broadcastAll({ type: "approval_requested", taskId, message, command });
    }
    return c.json({ ok: true });
  });

  router.get("/:id/approve/status", (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found" }, 404);
    if (task.pendingApproval) return c.json({ status: "pending" });
    if (task.status === "failed" && task.notes?.includes("Rejected"))
      return c.json({ status: "rejected" });
    return c.json({ status: "approved" });
  });

  router.post("/:id/approve/reject", (c) => {
    const taskId = c.req.param("id");
    db.tasks.update(taskId, {
      pendingApproval: false,
      status: "failed",
      notes: "Rejected by human.",
    });
    const task = db.tasks.getById(taskId);
    if (task) {
      orchestrator.hub.broadcastAll({ type: "task_updated", task });
    }
    return c.json({ ok: true });
  });

  router.post("/:id/approve", async (c) => {
    const taskId = c.req.param("id");
    const task = db.tasks.getById(taskId);
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);

    if (!task.pendingApproval) {
      return c.json({ error: "invalid_state", message: "Task does not require approval" }, 400);
    }

    try {
      db.tasks.update(taskId, { pendingApproval: false });
      const updated = db.tasks.getById(taskId);
      if (updated) {
        orchestrator.hub.broadcastAll({ type: "task_updated", task: updated });
      }
      return c.json({ data: { ok: true } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "approve_failed", message: msg }, 500);
    }
  });

  router.post("/:id/retry", async (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);

    if (task.status !== "failed") {
      return c.json({ error: "invalid_state", message: "Can only retry failed tasks" }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = launchTaskSchema.safeParse(body);
    const engineOverride = parsed.success ? parsed.data.engine : undefined;
    const modelOverride = parsed.success ? parsed.data.model : undefined;

    try {
      const run = await orchestrator.launch(task, engineOverride, modelOverride);
      return c.json({ data: run }, 202);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "retry_failed", message: msg }, 500);
    }
  });

  router.post("/:id/retry-pr", async (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);

    if (task.status !== "review") {
      return c.json(
        { error: "invalid_state", message: "Can only retry PR for tasks in review" },
        400
      );
    }

    try {
      const prUrl = await orchestrator.retryPR(task.id);
      return c.json({ data: { prUrl } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "retry_pr_failed", message: msg }, 500);
    }
  });

  router.get("/:id/runs", (c) => {
    const runs = db.runs.listByTask(c.req.param("id"));
    return c.json({ data: runs });
  });

  router.get("/:id/artifacts", (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);
    return c.json({ data: db.artifacts.listByTask(task.id) });
  });

  // ─── Schedule Endpoints ─────────────────────────────────────────────────────

  const upsertScheduleSchema = z.object({
    cronExpression: z.string().min(1),
    enabled: z.boolean().optional(),
    deadlineAt: z.string().nullable().optional(),
  });

  router.get("/:id/schedule", (c) => {
    const schedule = db.schedules.getByTaskId(c.req.param("id"));
    return c.json({ data: schedule ?? null });
  });

  router.put("/:id/schedule", async (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);

    const body = await c.req.json();
    const parsed = upsertScheduleSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "validation", message: parsed.error.message }, 400);

    // Validate cron expression
    let nextRunAt: string | null;
    try {
      nextRunAt = computeNextRun(parsed.data.cronExpression);
      if (nextRunAt === null) throw new Error("Expression produces no future run");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "validation", message: `Invalid cron expression: ${msg}` }, 400);
    }

    let schedule = db.schedules.upsert(
      task.id,
      parsed.data.cronExpression,
      parsed.data.deadlineAt ?? null,
      nextRunAt
    );

    if (parsed.data.enabled === false) {
      schedule = db.schedules.setEnabled(task.id, false) ?? schedule;
    }

    // Always move the task to "scheduled" template status
    if (task.status !== "scheduled") {
      db.tasks.update(task.id, { status: "scheduled" });
    }

    return c.json({ data: schedule });
  });

  router.delete("/:id/schedule", (c) => {
    db.schedules.remove(c.req.param("id"));
    return c.json({ data: { ok: true } });
  });

  router.post("/:id/schedule/toggle", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const enabled = typeof body?.enabled === "boolean" ? body.enabled : true;
    const schedule = db.schedules.setEnabled(c.req.param("id"), enabled);
    if (!schedule) return c.json({ error: "not_found", message: "No schedule found" }, 404);
    return c.json({ data: schedule });
  });

  router.post("/:id/schedule/run-now", async (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);

    try {
      const run = await orchestrator.triggerScheduled(task.id);

      // Advance next_run_at on the schedule if one exists
      const schedule = db.schedules.getByTaskId(task.id);
      if (schedule) {
        const next = computeNextRun(schedule.cronExpression);
        db.schedules.updateAfterRun(task.id, next);
      }

      return c.json({ data: run }, 202);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "run_now_failed", message: msg }, 500);
    }
  });

  // ─── Diff Endpoints ─────────────────────────────────────────────────────────

  router.get("/:id/diff", async (c) => {
    if (!git) return c.json({ error: "unavailable", message: "Git service not configured" }, 500);

    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);
    if (!task.branchName)
      return c.json({ data: { files: [], totalAdditions: 0, totalDeletions: 0 } as DiffSummary });

    const repo = db.repos.getById(task.repoId);
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);

    const barePath = repo.localPath ?? git.getBarePath(repo.name);
    const latestRun = db.runs.getLatestByTask(task.id);

    try {
      // If there's a running agent with a worktree, diff in the worktree
      const useWorktree = latestRun?.worktreePath && latestRun.status === "running";
      // biome-ignore lint/style/noNonNullAssertion: useWorktree guarantees worktreePath is set
      const opts = useWorktree ? { cwd: latestRun.worktreePath! } : { gitDir: barePath };

      const baseBranch = useWorktree ? `origin/${repo.defaultBranch}` : repo.defaultBranch;
      const headBranch = useWorktree ? "HEAD" : task.branchName;

      const files = await git.diffSummary(baseBranch, headBranch, opts);
      const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
      const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

      return c.json({
        data: {
          files: files as DiffFileSummary[],
          totalAdditions,
          totalDeletions,
        } satisfies DiffSummary,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "diff_failed", message: msg }, 500);
    }
  });

  router.get("/:id/diff/file", async (c) => {
    if (!git) return c.json({ error: "unavailable", message: "Git service not configured" }, 500);

    const filePath = c.req.query("path");
    if (!filePath)
      return c.json({ error: "validation", message: "Missing 'path' query parameter" }, 400);
    // Guard against path traversal (literal ".." and URL-encoded variants)
    const decoded = decodeURIComponent(filePath);
    if (decoded.includes("..") || decoded.startsWith("/") || decoded.includes("\0"))
      return c.json({ error: "validation", message: "Invalid file path" }, 400);

    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);
    if (!task.branchName) return c.json({ data: { patch: "" } });

    const repo = db.repos.getById(task.repoId);
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);

    const barePath = repo.localPath ?? git.getBarePath(repo.name);
    const latestRun = db.runs.getLatestByTask(task.id);

    try {
      const useWorktree = latestRun?.worktreePath && latestRun.status === "running";
      // biome-ignore lint/style/noNonNullAssertion: useWorktree guarantees worktreePath is set
      const opts = useWorktree ? { cwd: latestRun.worktreePath! } : { gitDir: barePath };

      const baseBranch = useWorktree ? `origin/${repo.defaultBranch}` : repo.defaultBranch;
      const headBranch = useWorktree ? "HEAD" : task.branchName;

      const patch = await git.diffFileContent(baseBranch, headBranch, filePath, opts);
      return c.json({ data: { patch } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "diff_failed", message: msg }, 500);
    }
  });

  // M7.1: Matched skills for the latest run of a task
  router.get("/:id/matched-skills", (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);
    const runs = db.runs.listByTask(task.id);
    const latest = runs[0];
    if (!latest) return c.json({ data: [] });
    try {
      const matched = JSON.parse(latest.matchedSkills ?? "[]");
      return c.json({ data: matched });
    } catch {
      return c.json({ data: [] });
    }
  });

  // Download task worktree as a zip archive
  // Open task worktree in editor
  router.post("/:id/open-editor", async (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);

    const repo = db.repos.getById(task.repoId);
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);

    const latestRun = db.runs.getLatestByTask(task.id);
    const targetPath =
      latestRun?.worktreePath ?? repo.localPath ?? (git ? git.getBarePath(repo.name) : null);

    if (!targetPath) {
      return c.json({ error: "invalid_state", message: "No path available to open" }, 400);
    }

    const editorCommand = process.env.EDITOR || "code";

    try {
      Bun.spawn([editorCommand, targetPath], {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
      }).unref();
      return c.json({ data: { ok: true } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "editor_failed", message: `Failed to open editor: ${msg}` }, 500);
    }
  });

  router.get("/:id/download", async (c) => {
    if (!git) return c.json({ error: "unavailable", message: "Git service not available" }, 503);

    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);
    if (!task.branchName) {
      return c.json({ error: "invalid_state", message: "Task has no branch yet" }, 400);
    }

    const repo = db.repos.getById(task.repoId);
    if (!repo) return c.json({ error: "not_found", message: "Repository not found" }, 404);

    const barePath = repo.localPath ?? git.getBarePath(repo.name);
    const safeName = repo.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeBranch = task.branchName.replace(/[^a-zA-Z0-9_/-]/g, "_").replace(/\//g, "-");
    const archiveName = `${safeName}_${safeBranch}.zip`;
    const tmpPath = join(tmpdir(), `vibe-${randomBytes(8).toString("hex")}.zip`);

    try {
      const proc = Bun.spawn(
        ["git", "--git-dir", barePath, "archive", "--format=zip", "-o", tmpPath, task.branchName],
        { stderr: "pipe" }
      );
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const errText = await new Response(proc.stderr).text();
        return c.json({ error: "archive_failed", message: errText.trim() }, 500);
      }

      const file = Bun.file(tmpPath);
      const buffer = await file.arrayBuffer();

      c.header("Content-Type", "application/zip");
      c.header("Content-Disposition", `attachment; filename="${archiveName}"`);
      c.header("Content-Length", String(buffer.byteLength));
      return c.body(buffer);
    } finally {
      unlink(tmpPath).catch(() => {});
    }
  });

  return router;
}
