import { describe, expect, mock, test } from "bun:test";

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: `task-${Math.random().toString(36).slice(2, 7)}`,
    title: "Test task",
    status: "in_progress",
    engine: "opencode",
    model: null,
    priority: "none",
    repoId: "repo-1",
    branchName: "feat/test",
    dependsOn: [],
    prUrl: null,
    baseBranch: "main",
    tags: [],
    loopConfig: null,
    latestRun: null,
    ...overrides,
  };
}

describe("Orchestrator coverage", () => {
  test("sweepBacklog respects priority and maxConcurrent", async () => {
    const tasks = [
      makeTask({ id: "t1", priority: "low", status: "backlog" }),
      makeTask({ id: "t2", priority: "urgent", status: "backlog" }),
      makeTask({ id: "t3", priority: "high", status: "backlog" }),
    ];

    const launched: string[] = [];
    const mockDb = {
      tasks: {
        list: mock().mockImplementation((_repoId: unknown, status: string) =>
          status === "in_progress" ? [] : tasks
        ),
        getById: mock().mockImplementation((id: string) => tasks.find((t) => t.id === id)),
        update: mock(),
      },
      repos: {
        getById: mock().mockReturnValue({
          id: "repo-1",
          name: "repo",
          status: "ready",
          defaultBranch: "main",
        }),
      },
      runs: { create: mock().mockReturnValue({ id: "run-1" }) },
      logs: { create: mock() },
    };

    const mockRegistry = {
      get: mock().mockReturnValue({ name: "opencode", abort: mock() }),
      getFirstAvailable: mock().mockResolvedValue({ name: "opencode", abort: mock() }),
    };

    const mockHub = {
      broadcastAll: mock(),
      broadcastToTask: mock(),
    };

    const { Orchestrator } = await import("./orchestrator");
    // maxConcurrent = 2
    const orch = new Orchestrator(mockDb as any, {} as any, mockRegistry as any, mockHub as any, 2);

    // We override launch to just record the launched tasks instead of running full executeAgent
    orch.launch = mock().mockImplementation(async (task) => {
      launched.push(task.id);
      (orch as any).activeRuns.set(task.id, {
        runId: "r",
        taskId: task.id,
        engineName: "e",
        abort: new AbortController(),
      });
    });

    await orch.sweepBacklog();

    // With maxConcurrent = 2, only top 2 priorities should be launched: urgent (t2), high (t3)

    expect(launched).toEqual(["t2", "t3"]);
  });

  test("getRetryQueueSnapshot returns mapped items", async () => {
    const { Orchestrator } = await import("./orchestrator");
    const orch = new Orchestrator({} as any, {} as any, {} as any, {} as any, 2);

    // Populate retry queue
    (orch as any).retryQueue.set("t1", {
      attempt: 2,
      dueAt: Date.now() + 5000,
      reason: "failed",
      timer: setTimeout(() => {}, 5000),
    });

    const snapshot = orch.getRetryQueueSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].taskId).toBe("t1");
    expect(snapshot[0].attempt).toBe(2);
    expect(snapshot[0].dueInMs).toBeGreaterThan(0);
    expect(snapshot[0].reason).toBe("failed");

    // Cleanup timer
    (orch as any).cancelRetry("t1");
  });

  test("maybeScheduleRetry blocks a failed task after retry budget is exhausted", async () => {
    const task = makeTask({ id: "t1", status: "failed", notes: "" });
    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const mockDb = {
      tasks: {
        getById: mock().mockImplementation(() => task),
        update: mock().mockImplementation((id: string, data: Record<string, unknown>) => {
          updates.push({ id, data });
          Object.assign(task, data);
          return { ...task };
        }),
      },
      runs: {
        getLatestByTask: mock().mockReturnValue({ errorMessage: "Agent exited with code 1" }),
      },
    };
    const mockHub = { broadcastAll: mock() };

    const { Orchestrator } = await import("./orchestrator");
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, mockHub as any, 1);

    (orch as any).maybeScheduleRetry("t1");
    (orch as any).maybeScheduleRetry("t1");
    (orch as any).maybeScheduleRetry("t1");

    expect(updates.at(-1)?.data.status).toBe("blocked");
    expect((task as unknown as { notes: string }).notes).toContain(
      "Agent failed after 2 automatic retry attempt"
    );
    expect(mockHub.broadcastAll).toHaveBeenCalledWith({
      type: "task_blocked",
      taskId: "t1",
      blockedBy: ["Agent failed after 2 automatic retry attempt(s)."],
    });

    (orch as any).cancelRetry("t1");
  });

  test("recoverInProgressTasks correctly parks tasks according to limits", async () => {
    const tasks = [
      makeTask({ id: "t1", priority: "none", status: "in_progress" }),
      makeTask({ id: "t2", priority: "low", status: "in_progress" }),
      makeTask({ id: "t3", priority: "high", status: "in_progress" }),
      makeTask({ id: "t4", priority: "urgent", status: "in_progress" }),
      makeTask({ id: "t5", priority: "medium", status: "in_progress" }),
    ];

    const updatedStatuses: Record<string, string> = {};
    const mockDb = {
      tasks: {
        list: mock().mockImplementation((_repoId: unknown, status: string) =>
          status === "in_progress" ? tasks : []
        ),
        update: mock().mockImplementation((id: string, data: { status: string }) => {
          updatedStatuses[id] = data.status;
        }),
      },
    };

    const mockHub = {
      broadcastAll: mock(),
    };

    const { Orchestrator } = await import("./orchestrator");
    // maxConcurrent = 2
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, mockHub as any, 2);

    await orch.recoverInProgressTasks();

    // Priority order: urgent (t4), high (t3), medium (t5), low (t2), none (t1)
    // First 2 should be 'backlog', rest 'blocked'
    expect(updatedStatuses.t4).toBe("backlog");
    expect(updatedStatuses.t3).toBe("backlog");
    expect(updatedStatuses.t5).toBe("blocked");
    expect(updatedStatuses.t2).toBe("blocked");
    expect(updatedStatuses.t1).toBe("blocked");
  });

  test("recoverInProgressTasks parks excess in_progress tasks as blocked when over concurrency limit", async () => {
    const inProgressTasks = [
      makeTask({ id: "t1", status: "in_progress", priority: "urgent" }),
      makeTask({ id: "t2", status: "in_progress", priority: "high" }),
      makeTask({ id: "t3", status: "in_progress", priority: "medium" }),
    ];

    const mockDb = {
      tasks: {
        list: mock().mockReturnValue(inProgressTasks),
        update: mock(),
      },
    };

    const mockHub = {
      broadcastAll: mock(),
    };

    const { Orchestrator } = await import("./orchestrator");
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, mockHub as any, 2); // Limit 2

    await orch.recoverInProgressTasks();

    expect(mockDb.tasks.update).toHaveBeenCalledWith("t1", { status: "backlog" });
    expect(mockDb.tasks.update).toHaveBeenCalledWith("t2", { status: "backlog" });
    expect(mockDb.tasks.update).toHaveBeenCalledWith("t3", { status: "blocked" });
  });

  test("unblockTask moves blocked task to backlog and triggers sweepBacklog", async () => {
    const task = makeTask({ id: "t1", status: "blocked" });
    const mockDb = {
      tasks: {
        getById: mock().mockReturnValue(task),
        update: mock(),
      },
    };
    const mockHub = { broadcastAll: mock() };
    const { Orchestrator } = await import("./orchestrator");
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, mockHub as any, 1);

    orch.sweepBacklog = mock().mockResolvedValue(undefined);

    await orch.unblockTask("t1");

    expect(mockDb.tasks.update).toHaveBeenCalledWith("t1", { status: "backlog" });
    expect(mockHub.broadcastAll).toHaveBeenCalledWith({
      type: "task_updated",
      task: { ...task, status: "backlog" },
    });
    expect(orch.sweepBacklog).toHaveBeenCalled();
  });

  test("unblockTask does nothing if task is not blocked", async () => {
    const task = makeTask({ id: "t1", status: "in_progress" });
    const mockDb = {
      tasks: {
        getById: mock().mockReturnValue(task),
        update: mock(),
      },
    };
    const mockHub = { broadcastAll: mock() };
    const { Orchestrator } = await import("./orchestrator");
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, mockHub as any, 1);

    orch.sweepBacklog = mock().mockResolvedValue(undefined);

    await orch.unblockTask("t1");

    expect(mockDb.tasks.update).not.toHaveBeenCalled();
    expect(mockHub.broadcastAll).not.toHaveBeenCalled();
    expect(orch.sweepBacklog).not.toHaveBeenCalled();
  });
});
