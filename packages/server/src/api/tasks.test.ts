import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { testClient } from "hono/testing";
// Mock orchestrator helpers
import * as taskPlan from "../agents/orchestrator/task-plan";

// Access control helper mocks
import * as accessControl from "../security/access-control";
import { createTasksRouter } from "./tasks";

describe("Tasks Router (unit)", () => {
  const mockDb = {
    tasks: {
      list: mock().mockReturnValue([]),
      getById: mock(),
      listChildren: mock(),
      create: mock().mockReturnValue({ id: "t-2", title: "New Task" }),
      update: mock().mockReturnValue({ id: "t-1", title: "Updated" }),
      remove: mock(),
      archiveDone: mock().mockReturnValue(1),
      clearFailed: mock().mockReturnValue(1),
    },
    runs: {
      listLatestByTaskIds: mock().mockReturnValue([]),
      listByTask: mock().mockReturnValue([]),
      getLatestByTask: mock(),
    },
    repos: {
      listByIds: mock().mockReturnValue([]),
      getById: mock(),
    },
    schedules: {
      listAll: mock().mockReturnValue([]),
      getByTaskId: mock(),
      upsert: mock(),
      remove: mock(),
      setEnabled: mock(),
      updateAfterRun: mock(),
    },
    artifacts: {
      listByTask: mock(),
    },
    logs: {
      listByRun: mock().mockReturnValue([]),
      listByRunAfter: mock().mockReturnValue([]),
    },
    settings: {
      get: mock().mockReturnValue("false"),
    },
    findings: {
      getRecentByRepo: mock().mockReturnValue([]),
    },
    memories: {
      getByTaskIdAndScope: mock().mockReturnValue(null),
    },
  };
  const mockOrchestrator = {
    launch: mock(),
    unblockTask: mock(),
    cancel: mock(),
    hub: {
      broadcastAll: mock(),
    },
  } as any;
  const mockGitService = {
    getBarePath: mock().mockReturnValue("/mock/bare"),
    createWorktree: mock().mockResolvedValue("/mock/wt"),
    cleanupWorktree: mock().mockResolvedValue(true),
    removeWorktree: mock().mockResolvedValue(true),
    diffSummary: mock(),
    diffFileContent: mock(),
  } as any;

  spyOn(accessControl, "resolveAccessContext").mockImplementation(async () => {
    return {
      ok: true,
      context: { workspaceId: "ws-1", userId: "u-1", authEnabled: true },
      error: undefined,
    };
  });
  spyOn(accessControl, "enforceRepoAccess").mockImplementation(() => null);
  spyOn(accessControl, "enforceTaskAccess").mockImplementation(() => null);

  const router = createTasksRouter(mockDb as any, mockOrchestrator, mockGitService);

  beforeEach(() => {
    spyOn(accessControl, "resolveAccessContext").mockImplementation(async () => {
      return {
        ok: true,
        context: { workspaceId: "ws-1", userId: "u-1", authEnabled: true },
        error: undefined,
      };
    });
    spyOn(accessControl, "enforceRepoAccess").mockImplementation(() => null);
    spyOn(accessControl, "enforceTaskAccess").mockImplementation(() => null);
  });

  afterAll(() => {
    mock.restore();
  });

  it("POST /archive-done archives tasks", async () => {
    const res = await router.request("/archive-done?repo_id=r-1", { method: "POST" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.archived).toBe(1);
  });

  it("POST /clear-failed clears failed tasks", async () => {
    const res = await router.request("/clear-failed?repo_id=r-1", { method: "POST" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.deleted).toBe(1);
  });

  it("POST /retry-failed retries failed tasks", async () => {
    mockDb.tasks.list.mockReturnValueOnce([
      { id: "t-1", status: "failed" },
      { id: "t-2", status: "failed" },
    ]);
    mockOrchestrator.launch.mockResolvedValueOnce();
    mockOrchestrator.launch.mockRejectedValueOnce(new Error("err")); // Second one fails

    const res = await router.request("/retry-failed?repo_id=r-1", { method: "POST" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.retried).toBe(1);
  });

  it("POST /:id/cancel cancels task", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", status: "in_progress" });
    mockOrchestrator.cancel.mockResolvedValueOnce();

    const res = await router.request("/t-1/cancel", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("POST /:id/cancel handles cancel errors", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", status: "in_progress" });
    mockOrchestrator.cancel.mockRejectedValueOnce(new Error("cancel failed"));

    const res = await router.request("/t-1/cancel", { method: "POST" });
    expect(res.status).toBe(500);
    const json = (await res.json()) as any;
    expect(json.message).toBe("cancel failed");
  });

  it("POST /:id/plan handles invalid payload", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1" });
    const res = await router.request("/t-1/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialize: "invalid" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /:id/plan successfully materializes plan", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1" });
    spyOn(taskPlan, "buildTaskExecutionPlan").mockReturnValueOnce([] as any);
    spyOn(taskPlan, "materializeTaskExecutionPlan").mockReturnValueOnce({
      plan: [],
      createdTasks: [],
      reusedTasks: [],
    } as any);

    const res = await router.request("/t-1/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialize: true }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /:id/plan successfully returns unmaterialized plan", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1" });
    spyOn(taskPlan, "buildTaskExecutionPlan").mockReturnValueOnce([] as any);

    const res = await router.request("/t-1/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialize: false }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /bulk/from-issues returns 400 on invalid payload", async () => {
    const res = await router.request("/bulk/from-issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: "r-1", issues: "invalid" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /bulk/from-issues returns 404 if repo not found", async () => {
    mockDb.repos.getById.mockReturnValueOnce(null);
    const res = await router.request("/bulk/from-issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoId: "r-unknown",
        issues: [
          {
            id: "i-1",
            number: 1,
            title: "Title",
            body: null,
            labels: [],
            url: "http://example.com",
          },
        ],
      }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /bulk/from-issues creates tasks successfully", async () => {
    mockDb.repos.getById.mockReturnValueOnce({ id: "r-1", name: "Repo 1" });
    const res = await router.request("/bulk/from-issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoId: "r-1",
        autoLabel: "bug",
        issues: [
          {
            id: "i-1",
            number: 1,
            title: "Issue 1",
            body: "Description",
            labels: ["l1"],
            url: "http://example.com",
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
  });

  // Coverage for tasks formatting missing lines
  it("GET / returns tasks with run info including costStats mapping", async () => {
    mockDb.tasks.list.mockReturnValueOnce([{ id: "t-1", repoId: "r-1", title: "Task 1" }]);
    mockDb.repos.listByIds.mockReturnValueOnce([{ id: "r-1", name: "Repo 1" }]);
    mockDb.runs.listLatestByTaskIds.mockReturnValueOnce([{ id: "run-1", taskId: "t-1" }]);
    // Use costStats branch for mapTasksWithRuns
    mockDb.runs.listByTask.mockReturnValueOnce([
      {
        id: "run-1",
        engine: "mock",
        costStats: {
          total_tokens: 100,
          input_tokens: 50,
          output_tokens: 50,
          input: 1000000,
          output: 2000000,
          total: 3000000,
        },
        sessionId: "ses-1",
      },
    ]);

    const res = await router.request("/");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe("t-1");
    expect(json.data[0].usageSummary.sessionIds).toEqual(["ses-1"]);
    expect(json.data[0].usageSummary.totalTokens).toBe(100);
    expect(json.data[0].usageSummary.inputTokens).toBe(50);
    expect(json.data[0].usageSummary.outputTokens).toBe(50);
  });

  it("GET / returns 403 on authorization failure", async () => {
    spyOn(accessControl, "resolveAccessContext").mockImplementationOnce(async () => {
      return {
        ok: false,
        context: undefined,
        error: { allowed: false, status: 403, code: "forbidden", message: "Forbidden" },
      };
    });
    const res = await router.request("/");
    expect(res.status).toBe(403);
  });

  it("GET / returns 403 on fallback auth failure", async () => {
    spyOn(accessControl, "resolveAccessContext").mockImplementationOnce(async () => {
      return { ok: false, context: undefined, error: undefined };
    });
    const res = await router.request("/");
    expect(res.status).toBe(403);
  });

  it("GET / with repo_id enforces access", async () => {
    // Reset the enforceRepoAccess spy specifically for this test
    spyOn(accessControl, "enforceRepoAccess").mockImplementationOnce(
      () => ({ allowed: false, status: 403, code: "forbidden", message: "Forbidden" }) as any
    );
    const res = await router.request("/?repo_id=r-1");
    expect(res.status).toBe(403);
  });

  it("GET /poll handles auth failures", async () => {
    spyOn(accessControl, "resolveAccessContext").mockImplementationOnce(async () => {
      return { ok: false, context: undefined, error: undefined };
    });
    const res = await router.request("/poll");
    expect(res.status).toBe(403);
  });

  it("GET /poll with repo_id enforces access", async () => {
    spyOn(accessControl, "enforceRepoAccess").mockImplementationOnce(
      () => ({ allowed: false, status: 403, code: "forbidden", message: "Forbidden" }) as any
    );
    const res = await router.request("/poll?repo_id=r-1");
    expect(res.status).toBe(403);
  });

  it("POST / returns 400 on invalid payload", async () => {
    const res = await router.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // invalid missing fields
    });
    expect(res.status).toBe(400);
  });

  it("POST / returns 404 if repo not found", async () => {
    mockDb.repos.getById.mockReturnValueOnce(null);
    const res = await router.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New", repoId: "r-1" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST / returns 201 on valid payload", async () => {
    mockDb.repos.getById.mockReturnValueOnce({ id: "r-1", name: "Repo 1" });
    const res = await router.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New", repoId: "r-1" }),
    });
    expect(res.status).toBe(201);
  });

  it("PATCH /:id returns 400 on invalid payload", async () => {
    const res = await router.request("/t-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "invalid_status" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /:id returns 404 when task not found", async () => {
    mockDb.tasks.update.mockReturnValueOnce(null);
    const res = await router.request("/t-unknown", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test" }),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH /:id successfully updates task", async () => {
    mockDb.tasks.update.mockReturnValueOnce({ id: "t-1", title: "Updated", maxCost: 5.0 });
    const res = await router.request("/t-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated", maxCost: 5.0 }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.title).toBe("Updated");
  });

  it("DELETE /:id returns 404 when task not found", async () => {
    mockDb.tasks.getById.mockReturnValueOnce(null);
    const res = await router.request("/t-unknown", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("POST /:id/clone returns 404 when task not found", async () => {
    mockDb.tasks.getById.mockReturnValueOnce(null);
    const res = await router.request("/t-unknown/clone", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("POST /:id/clone clones the task", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", title: "Original" });
    mockDb.tasks.create.mockReturnValueOnce({ id: "t-copy", title: "Original (copy)" });

    const res = await router.request("/t-1/clone", { method: "POST" });
    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.data.id).toBe("t-copy");
  });

  it("POST /:id/launch returns 403 on auth failure", async () => {
    spyOn(accessControl, "resolveAccessContext").mockImplementationOnce(async () => {
      return { ok: false, context: undefined, error: undefined };
    });
    const res = await router.request("/t-1/launch", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("POST /:id/unblock returns 400 when task not blocked", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", status: "in_progress" });
    const res = await router.request("/t-1/unblock", { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("POST /:id/unblock returns 500 when orchestrator fails", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", status: "blocked" });
    mockOrchestrator.unblockTask.mockRejectedValueOnce(new Error("failed to unblock"));
    const res = await router.request("/t-1/unblock", { method: "POST" });
    expect(res.status).toBe(500);
  });

  it("GET /:id returns task data with related info", async () => {
    // Make sure we stub enforceTaskAccess as well, so we don't get 403
    spyOn(accessControl, "enforceTaskAccess").mockImplementationOnce(() => null);

    mockDb.tasks.getById.mockImplementation((id: string) => {
      if (id === "t-1") return { id: "t-1", repoId: "r-1", title: "Task 1" };
      return null;
    });
    mockDb.runs.getLatestByTask.mockReturnValueOnce({ id: "run-1" });
    mockDb.repos.getById.mockReturnValueOnce({ id: "r-1", name: "Repo 1" });

    const res = await router.request("/t-1");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.id).toBe("t-1");
    expect(json.data.latestRun.id).toBe("run-1");
  });

  it("GET /:id returns 404 if not found", async () => {
    spyOn(accessControl, "enforceTaskAccess").mockImplementationOnce(() => null);
    mockDb.tasks.getById.mockImplementation((id: string) => {
      return null;
    });
    const res = await router.request("/t-unknown");
    expect(res.status).toBe(404);
  });

  it("GET /:id returns 403 on auth error", async () => {
    spyOn(accessControl, "resolveAccessContext").mockImplementationOnce(async () => {
      return { ok: false, context: undefined, error: undefined };
    });
    const res = await router.request("/t-1");
    expect(res.status).toBe(403);
  });

  it("GET /:id returns 403 if task access enforced fails", async () => {
    spyOn(accessControl, "enforceTaskAccess").mockImplementationOnce(
      () => ({ allowed: false, status: 403, code: "forbidden", message: "Forbidden" }) as any
    );
    const res = await router.request("/t-1");
    expect(res.status).toBe(403);
  });

  it("POST /:id/launch returns 400 if task is not in a valid state to launch", async () => {
    spyOn(accessControl, "enforceTaskAccess").mockImplementationOnce(() => null);
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", status: "done" }); // invalid state

    const res = await router.request("/t-1/launch", { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.error).toBe("invalid_state");
  });

  it("POST /:id/launch handles capacity limit errors gracefully", async () => {
    spyOn(accessControl, "enforceTaskAccess").mockImplementationOnce(() => null);
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", status: "backlog" });
    const capErr = new Error("Capacity full") as any;
    capErr.capacityExceeded = true;
    mockOrchestrator.launch.mockRejectedValueOnce(capErr);

    const res = await router.request("/t-1/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(429);
    const json = (await res.json()) as any;
    expect(json.error).toBe("capacity_full");
  });

  it("POST /:id/launch handles normal launch errors gracefully", async () => {
    spyOn(accessControl, "enforceTaskAccess").mockImplementationOnce(() => null);
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", status: "backlog" });
    mockOrchestrator.launch.mockRejectedValueOnce(new Error("Unknown error"));

    const res = await router.request("/t-1/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(500);
    const json = (await res.json()) as any;
    expect(json.error).toBe("launch_failed");
  });

  it("GET /:id/children returns children", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", title: "Task 1" });
    mockDb.tasks.listChildren.mockReturnValueOnce([{ id: "t-2", title: "Task 2" }]);

    const res = await router.request("/t-1/children");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe("t-2");
  });

  it("GET /:id/children returns 404 if parent not found", async () => {
    mockDb.tasks.getById.mockReturnValueOnce(null);

    const res = await router.request("/t-1/children");
    expect(res.status).toBe(404);
  });

  it("POST /bulk/from-issues creates tasks and returns data", async () => {
    mockDb.repos.getById.mockReturnValueOnce({ id: "r-1", name: "Repo 1" });
    mockDb.tasks.create.mockReturnValueOnce({ id: "t-created", title: "Issue 1" });

    const req = new Request("http://localhost/bulk/from-issues", {
      method: "POST",
      body: JSON.stringify({
        repoId: "r-1",
        autoLabel: "bug",
        issues: [
          {
            id: "i-1",
            number: 1,
            title: "Issue 1",
            body: "Description",
            labels: ["l1"],
            url: "http://example.com",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await router.request(req);
    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.data.created).toHaveLength(1);
    expect(json.data.created[0].title).toBe("Issue 1");
  });

  it("POST /:id/preview-prompt returns 404 if task not found", async () => {
    mockDb.tasks.getById.mockReturnValueOnce(null);
    const res = await router.request("/t-unknown/preview-prompt", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("POST /:id/preview-prompt returns prompt when repository found", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", repoId: "r-1", title: "Task 1" });
    mockDb.repos.getById.mockReturnValueOnce({ id: "r-1", name: "Repo 1" });
    mockDb.runs.getLatestByTask.mockReturnValueOnce(null);
    mockDb.findings.getRecentByRepo.mockReturnValueOnce([]);

    // Test the branch that generates fallback prompt when worktree fails
    const res = await router.request("/t-1/preview-prompt", { method: "POST" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.prompt).toBeDefined();
    expect(json.data.materialized).toBe(false);
  });

  it("POST /:id/approve/request broadcasts request", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1" });
    const res = await router.request("/t-1/approve/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "msg", command: "cmd" }),
    });
    expect(res.status).toBe(200);
    expect(mockOrchestrator.hub.broadcastAll).toHaveBeenCalled();
  });

  it("GET /:id/approve/status returns status", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", pendingApproval: true });
    const res = await router.request("/t-1/approve/status");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.status).toBe("pending");
  });

  it("POST /:id/approve/reject rejects request", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1" });
    const res = await router.request("/t-1/approve/reject", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("POST /:id/approve approves request", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", pendingApproval: true });
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", pendingApproval: false }); // after update
    const res = await router.request("/t-1/approve", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("POST /:id/approve returns 400 if not pending", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", pendingApproval: false });
    const res = await router.request("/t-1/approve", { method: "POST" });
    expect(res.status).toBe(400);
  });

  // --- /:id/retry-pr ---
  it("POST /:id/retry-pr returns 404 if not found", async () => {
    mockDb.tasks.getById.mockReturnValueOnce(null);
    const res = await router.request("/t-unknown/retry-pr", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("POST /:id/retry-pr returns 400 if not in review state", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", status: "done" });
    const res = await router.request("/t-1/retry-pr", { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("POST /:id/retry-pr successfully retries PR", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", status: "review" });
    mockOrchestrator.retryPR = mock().mockResolvedValueOnce("http://pr.url");
    const res = await router.request("/t-1/retry-pr", { method: "POST" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.prUrl).toBe("http://pr.url");
  });

  it("POST /:id/retry-pr handles orchestrator error", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", status: "review" });
    mockOrchestrator.retryPR = mock().mockRejectedValueOnce(new Error("pr error"));
    const res = await router.request("/t-1/retry-pr", { method: "POST" });
    expect(res.status).toBe(500);
  });

  // --- /:id/runs ---
  it("GET /:id/runs returns runs for a task", async () => {
    spyOn(accessControl, "enforceTaskAccess").mockImplementationOnce(() => null);
    mockDb.runs.listByTask.mockReturnValueOnce([{ id: "run-1" }]);
    const res = await router.request("/t-1/runs");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe("run-1");
  });

  // --- /:id/artifacts ---
  it("GET /:id/artifacts returns artifacts for a task", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1" });
    mockDb.artifacts = { listByTask: mock().mockReturnValue([{ id: "art-1" }]) } as any;
    const res = await router.request("/t-1/artifacts");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data).toHaveLength(1);
  });

  it("GET /:id/artifacts returns 404 if task not found", async () => {
    mockDb.tasks.getById.mockReturnValueOnce(null);
    const res = await router.request("/t-unknown/artifacts");
    expect(res.status).toBe(404);
  });

  // --- /:id/schedule ---
  it("GET /:id/schedule returns schedule", async () => {
    mockDb.schedules.getByTaskId = mock().mockReturnValueOnce({ cronExpression: "0 * * * *" });
    const res = await router.request("/t-1/schedule");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.cronExpression).toBe("0 * * * *");
  });

  it("PUT /:id/schedule upserts schedule", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", status: "done" });
    mockDb.schedules.upsert = mock().mockReturnValueOnce({ cronExpression: "0 * * * *" });
    mockDb.tasks.update.mockReturnValueOnce({ id: "t-1", status: "scheduled" });

    const res = await router.request("/t-1/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cronExpression: "0 0 * * *", enabled: true }),
    });
    expect(res.status).toBe(200);
  });

  it("PUT /:id/schedule handles bad cron", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1" });
    const res = await router.request("/t-1/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cronExpression: "invalid cron", enabled: true }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /:id/schedule removes schedule", async () => {
    mockDb.schedules.remove = mock();
    const res = await router.request("/t-1/schedule", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("POST /:id/schedule/toggle toggles schedule", async () => {
    mockDb.schedules.setEnabled = mock().mockReturnValueOnce({ enabled: false });
    const res = await router.request("/t-1/schedule/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /:id/schedule/run-now runs scheduled task", async () => {
    spyOn(accessControl, "enforceTaskAccess").mockImplementationOnce(() => null);
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1" });
    mockDb.schedules.getByTaskId = mock().mockReturnValueOnce(null);
    mockOrchestrator.triggerScheduled = mock().mockResolvedValueOnce({ id: "run-1" });

    const res = await router.request("/t-1/schedule/run-now", { method: "POST" });
    expect(res.status).toBe(202);
  });

  // --- /:id/diff ---
  it("GET /:id/diff returns diff summary", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", repoId: "r-1", branchName: "b-1" });
    mockDb.repos.getById.mockReturnValueOnce({ id: "r-1", name: "R1", defaultBranch: "main" });
    mockDb.runs.getLatestByTask.mockReturnValueOnce(null);
    mockGitService.diffSummary.mockResolvedValueOnce([{ additions: 10, deletions: 5 }]);

    const res = await router.request("/t-1/diff");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.totalAdditions).toBe(10);
    expect(json.data.totalDeletions).toBe(5);
  });

  // --- /:id/diff/file ---
  it("GET /:id/diff/file returns file patch", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1", repoId: "r-1", branchName: "b-1" });
    mockDb.repos.getById.mockReturnValueOnce({ id: "r-1", name: "R1", defaultBranch: "main" });
    mockDb.runs.getLatestByTask.mockReturnValueOnce(null);
    mockGitService.diffFileContent.mockResolvedValueOnce("patch-content");

    const res = await router.request("/t-1/diff/file?path=file.ts");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.patch).toBe("patch-content");
  });

  // --- /:id/matched-skills ---
  it("GET /:id/matched-skills returns matched skills", async () => {
    mockDb.tasks.getById.mockReturnValueOnce({ id: "t-1" });
    mockDb.runs.listByTask.mockReturnValueOnce([{ matchedSkills: '["skill1"]' }]);
    const res = await router.request("/t-1/matched-skills");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data).toEqual(["skill1"]);
  });
});
