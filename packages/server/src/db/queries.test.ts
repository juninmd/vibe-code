import { beforeEach, describe, expect, it } from "bun:test";
import { createDb } from "./index";

type Db = ReturnType<typeof createDb>;

function makeDb(): Db {
  return createDb(":memory:");
}

function seedRepo(db: Db, url = "https://github.com/test/repo.git") {
  const repo = db.repos.create({ url });
  db.repos.updateStatus(repo.id, "ready", "/path/repo.git");
  const result = db.repos.getById(repo.id);
  if (!result) throw new Error("Repo not found");
  return result;
}

describe("Repository queries", () => {
  it("creates a repo in pending status by default", () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/owner/repo.git" });
    expect(repo.status).toBe("pending");
    expect(repo.localPath).toBeNull();
  });

  it("updates status to ready with local path", () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/owner/repo.git" });
    db.repos.updateStatus(repo.id, "ready", "/some/path.git");
    const updated = db.repos.getById(repo.id);
    if (!updated) throw new Error("Repo not found");
    expect(updated.status).toBe("ready");
    expect(updated.localPath).toBe("/some/path.git");
  });

  it("lists all repos", () => {
    const db = makeDb();
    db.repos.create({ url: "https://github.com/a/r1.git" });
    db.repos.create({ url: "https://github.com/b/r2.git" });
    expect(db.repos.list().length).toBe(2);
  });

  it("extracts repo name from bare URL", () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "my-bare-project" });
    expect(repo.name).toBe("my-bare-project");
  });

  it("extracts repo name from URL", () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "https://github.com/owner/my-project.git" });
    expect(repo.name).toBe("my-project");
  });
});

describe("Database queries with repo and task", () => {
  let db: Db;
  let repoId: string;
  let taskId: string;
  let runId: string;

  beforeEach(() => {
    db = makeDb();
    repoId = seedRepo(db).id;
    taskId = db.tasks.create({ title: "Task", repoId }).id;
    runId = db.runs.create(taskId, "claude-code").id;
  });

  describe("Task queries", () => {
    it("creates task with backlog status", () => {
      const task = db.tasks.create({ title: "My task", repoId });
      expect(task.status).toBe("backlog");
      expect(task.title).toBe("My task");
      expect(task.description).toBe("");
      expect(task.prUrl).toBeNull();
      expect(task.branchName).toBeNull();
    });

    it("creates task with description", () => {
      const task = db.tasks.create({
        title: "Feature",
        description: "Add login page",
        repoId,
      });
      expect(task.description).toBe("Add login page");
    });

    it("creates task with engine preference", () => {
      const task = db.tasks.create({ title: "Task", repoId, engine: "claude-code" });
      expect(task.engine).toBe("claude-code");
    });

    it("lists all tasks", () => {
      expect(db.tasks.list().length).toBe(1); // One created in beforeEach
      db.tasks.create({ title: "Task 2", repoId });
      expect(db.tasks.list().length).toBe(2);
    });

    it("lists tasks filtered by repo", () => {
      const otherRepoId = seedRepo(db, "https://github.com/other/repo.git").id;
      db.tasks.create({ title: "Other", repoId: otherRepoId });
      const mine = db.tasks.list(repoId);
      expect(mine.length).toBe(1);
      expect(mine[0].title).toBe("Task");
    });

    it("updates task status", () => {
      const updated = db.tasks.update(taskId, { status: "in_progress" });
      expect(updated?.status).toBe("in_progress");
      expect(db.tasks.getById(taskId)?.status).toBe("in_progress");
    });

    it("updates specific fields via updateField", () => {
      db.tasks.updateField(taskId, "pr_url", "https://github.com/owner/repo/pull/1");
      const updated = db.tasks.getById(taskId);
      if (!updated) throw new Error("Task not found");
      expect(updated.prUrl).toBe("https://github.com/owner/repo/pull/1");
    });

    it("updateField sets branch_name", () => {
      db.tasks.updateField(taskId, "branch_name", "vibe-code/abc/my-task");
      expect(db.tasks.getById(taskId)?.branchName).toBe("vibe-code/abc/my-task");
    });

    it("deletes task", () => {
      db.tasks.remove(taskId);
      expect(db.tasks.getById(taskId)).toBeNull();
    });

    it("returns null for non-existent task", () => {
      expect(db.tasks.getById("non-existent-id")).toBeNull();
    });
  });

  describe("AgentRun queries", () => {
    it("creates a run in queued status", () => {
      const run = db.runs.create(taskId, "claude-code");
      expect(run.status).toBe("queued");
      expect(run.engine).toBe("claude-code");
      expect(run.taskId).toBe(taskId);
      expect(run.exitCode).toBeNull();
    });

    it("updates run status to running with started_at", () => {
      const now = new Date().toISOString();
      db.runs.updateStatus(runId, "running", { started_at: now });
      const updated = db.runs.getById(runId);
      if (!updated) throw new Error("Run not found");
      expect(updated.status).toBe("running");
      expect(updated.startedAt).toBe(now);
    });

    it("updates run status to completed with exit_code", () => {
      db.runs.updateStatus(runId, "completed", {
        finished_at: new Date().toISOString(),
        exit_code: 0,
      });
      const updated = db.runs.getById(runId);
      if (!updated) throw new Error("Run not found");
      expect(updated.status).toBe("completed");
      expect(updated.exitCode).toBe(0);
    });

    it("updates run status to failed with error_message", () => {
      db.runs.updateStatus(runId, "failed", { error_message: "Something went wrong" });
      const updated = db.runs.getById(runId);
      if (!updated) throw new Error("Run not found");
      expect(updated.status).toBe("failed");
      expect(updated.errorMessage).toBe("Something went wrong");
    });

    it("getLatestByTask returns the most recently created run", () => {
      const run2 = db.runs.create(taskId, "opencode");
      const latest = db.runs.getLatestByTask(taskId);
      expect(latest?.id).toBe(run2.id);
      expect(latest?.engine).toBe("opencode");
    });

    it("listByTask returns all runs for a task", () => {
      db.runs.create(taskId, "aider");
      expect(db.runs.listByTask(taskId).length).toBe(2);
    });

    it("returns null for latest run of task with no runs", () => {
      db.runs.updateStatus(runId, "failed", { error_message: "failed" }); // we could have removed, but we'll create a new task
      const newTaskId = db.tasks.create({ title: "New Task", repoId }).id;
      expect(db.runs.getLatestByTask(newTaskId)).toBeNull();
    });
  });

  describe("AgentLog queries", () => {
    it("creates and retrieves logs for a run", () => {
      db.logs.create(runId, "stdout", "Hello world");
      db.logs.create(runId, "stderr", "Error message");
      const logs = db.logs.listByRun(runId);
      expect(logs.length).toBe(2);
      expect(logs[0].content).toBe("Hello world");
      expect(logs[0].stream).toBe("stdout");
      expect(logs[1].stream).toBe("stderr");
    });

    it("logs are ordered by insertion (id ASC)", () => {
      db.logs.create(runId, "stdout", "first");
      db.logs.create(runId, "stdout", "second");
      db.logs.create(runId, "stdout", "third");
      const logs = db.logs.listByRun(runId);
      expect(logs[0].content).toBe("first");
      expect(logs[2].content).toBe("third");
    });

    it("returns empty array for run with no logs", () => {
      expect(db.logs.listByRun(runId).length).toBe(0);
    });

    it("supports all stream types", () => {
      db.logs.create(runId, "stdout", "out");
      db.logs.create(runId, "stderr", "err");
      db.logs.create(runId, "system", "sys");
      db.logs.create(runId, "stdin", "in");
      const logs = db.logs.listByRun(runId);
      const streams = logs.map((l) => l.stream);
      expect(streams).toContain("stdout");
      expect(streams).toContain("stderr");
      expect(streams).toContain("system");
      expect(streams).toContain("stdin");
    });
  });

  describe("Task schedules queries", () => {
    it("upsert creates a new schedule", () => {
      const sched = db.schedules.upsert(taskId, "0 * * * *", null, "2024-01-01T00:00:00Z");
      expect(sched.taskId).toBe(taskId);
      expect(sched.enabled).toBe(true);
    });

    it("upsert updates an existing schedule", () => {
      db.schedules.upsert(taskId, "0 * * * *", null, "2024-01-01T00:00:00Z");
      const sched = db.schedules.upsert(taskId, "1 * * * *", null, "2024-01-01T00:00:00Z");
      expect(sched.cronExpression).toBe("1 * * * *");
    });

    it("setEnabled enables and disables", () => {
      db.schedules.upsert(taskId, "0 * * * *", null, "2024-01-01T00:00:00Z");
      const sched = db.schedules.setEnabled(taskId, false);
      expect(sched?.enabled).toBe(false);
    });

    it("listDue returns schedules due", () => {
      db.schedules.upsert(taskId, "0 * * * *", null, "2020-01-01T00:00:00Z");
      const due = db.schedules.listDue();
      expect(due.length).toBe(1);
      expect(due[0].taskId).toBe(taskId);
    });

    it("updateAfterRun updates nextRunAt", () => {
      db.schedules.upsert(taskId, "0 * * * *", null, "2024-01-01T00:00:00Z");
      db.schedules.updateAfterRun(taskId, "2025-01-01T00:00:00Z");
      const list = db.schedules.listAll();
      expect(list[0].nextRunAt).toBe("2025-01-01T00:00:00Z");
    });

    it("remove deletes a schedule", () => {
      db.schedules.upsert(taskId, "0 * * * *", null, "2024-01-01T00:00:00Z");
      db.schedules.remove(taskId);
      expect(db.schedules.listAll().length).toBe(0);
    });

    it("disableExpired disables expired schedules", () => {
      db.schedules.upsert(taskId, "0 * * * *", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z");
      db.schedules.disableExpired();
      const list = db.schedules.listAll();
      expect(list[0].enabled).toBe(false);
    });
  });

  describe("Findings queries", () => {
    it("create creates a finding", () => {
      const finding = db.findings.create({
        runId,
        taskId,
        repoId,
        persona: "Security",
        severity: "high",
        content: "found issue",
      });
      expect(finding.content).toBe("found issue");
      expect(finding.resolved).toBe(false);
    });

    it("listByRepo lists findings", () => {
      db.findings.create({
        runId,
        taskId,
        repoId,
        persona: "Security",
        severity: "high",
        content: "found issue",
      });
      const list = db.findings.listByRepo(repoId);
      expect(list.length).toBe(1);
      expect(list[0].content).toBe("found issue");
    });

    it("resolve resolves a finding", () => {
      const finding = db.findings.create({
        runId,
        taskId,
        repoId,
        persona: "Security",
        severity: "high",
        content: "found issue",
      });
      db.findings.resolve(finding.id);
      const list = db.findings.listByRepo(repoId);
      expect(list[0].resolved).toBe(true);
    });

    it("getRecentByRepo returns unresolved findings from last 30 days", () => {
      db.findings.create({
        runId,
        taskId,
        repoId,
        persona: "Security",
        severity: "high",
        content: "found issue",
      });
      const recent = db.findings.getRecentByRepo(repoId);
      expect(recent.length).toBe(1);
    });
  });

  describe("Metrics queries", () => {
    it("create creates a metric", () => {
      const metric = db.metrics.create({
        runId,
        taskId,
        repoId,
        engine: "claude-code",
        matchedSkills: ["React"],
        matchedRules: [],
        validatorAttempts: 1,
        reviewBlockers: 0,
        reviewWarnings: 0,
        finalStatus: "completed",
        prCreated: true,
      });
      expect(metric.engine).toBe("claude-code");
      expect(metric.matchedSkills).toEqual(["React"]);
      expect(metric.prCreated).toBe(true);
    });

    it("skillEffectiveness returns stats", () => {
      db.metrics.create({
        runId,
        taskId,
        repoId,
        engine: "claude-code",
        matchedSkills: ["React", "Typescript"],
        matchedRules: [],
        validatorAttempts: 1,
        reviewBlockers: 1,
        reviewWarnings: 0,
        finalStatus: "completed",
        prCreated: true,
      });
      db.metrics.create({
        runId,
        taskId,
        repoId,
        engine: "claude-code",
        matchedSkills: ["React"],
        matchedRules: [],
        validatorAttempts: 1,
        reviewBlockers: 0,
        reviewWarnings: 1,
        finalStatus: "failed",
        prCreated: false,
      });
      const stats = db.metrics.skillEffectiveness();
      expect(stats.length).toBe(2);
      const reactStats = stats.find((s) => s.name === "React");
      expect(reactStats?.totalRuns).toBe(2);
      expect(reactStats?.successRate).toBe(50.0);
      const tsStats = stats.find((s) => s.name === "Typescript");
      expect(tsStats?.totalRuns).toBe(1);
      expect(tsStats?.successRate).toBe(100.0);
    });

    it("engineEffectiveness returns stats", () => {
      db.metrics.create({
        runId,
        taskId,
        repoId,
        engine: "claude-code",
        matchedSkills: [],
        matchedRules: [],
        durationMs: 1000,
        validatorAttempts: 1,
        reviewBlockers: 1,
        reviewWarnings: 0,
        finalStatus: "completed",
        prCreated: true,
      });
      db.metrics.create({
        runId,
        taskId,
        repoId,
        engine: "opencode",
        matchedSkills: [],
        matchedRules: [],
        durationMs: 2000,
        validatorAttempts: 1,
        reviewBlockers: 0,
        reviewWarnings: 0,
        finalStatus: "completed",
        prCreated: true,
      });
      const stats = db.metrics.engineEffectiveness();
      expect(stats.length).toBe(2);
      const opencodeStats = stats.find((s) => s.engine === "opencode");
      expect(opencodeStats?.avgDurationSecs).toBe(2);
    });
  });
});

describe("Settings queries", () => {
  let db: Db;

  beforeEach(() => {
    db = makeDb();
  });

  it("get returns default null if key not found", () => {
    expect(db.settings.get("unknown_key")).toBeNull();
  });

  it("set sets a value and get retrieves it", () => {
    db.settings.set("my_key", "my_value");
    expect(db.settings.get("my_key")).toBe("my_value");
  });

  it("set overrides existing value", () => {
    db.settings.set("my_key", "my_value");
    db.settings.set("my_key", "new_value");
    expect(db.settings.get("my_key")).toBe("new_value");
  });
});

describe("Prompt templates queries", () => {
  let db: Db;

  beforeEach(() => {
    db = makeDb();
  });

  it("listAll returns predefined templates", () => {
    const list = db.prompts.list();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.id).toBeDefined();
  });

  it("getById returns a template", () => {
    const list = db.prompts.list();
    const tpl = db.prompts.getById(list[0]?.id ?? "");
    expect(tpl).toBeDefined();
    expect(tpl?.id).toBe(list[0]?.id);
  });

  it("create creates a custom template", () => {
    const tpl = db.prompts.create({
      title: "Custom",
      description: "Desc",
      content: "Content",
      category: "code",
    });
    expect(tpl.title).toBe("Custom");
    expect(tpl.isBuiltin).toBe(false);
  });

  it("update updates a custom template", () => {
    const tpl = db.prompts.create({
      title: "Custom",
      description: "Desc",
      content: "Content",
      category: "code",
    });
    const updated = db.prompts.update(tpl.id, { title: "Updated" });
    expect(updated?.title).toBe("Updated");
  });

  it("delete removes a custom template", () => {
    const tpl = db.prompts.create({
      title: "Custom",
      description: "Desc",
      content: "Content",
      category: "code",
    });
    expect(db.prompts.remove(tpl.id)).toBe(true);
    expect(db.prompts.getById(tpl.id)).toBeNull();
  });

  it("cannot update or delete a builtin template", () => {
    const list = db.prompts.list();
    const builtinId = list[0].id;
    const deleted = db.prompts.remove(builtinId);
    expect(deleted).toBe(false);
  });
});
