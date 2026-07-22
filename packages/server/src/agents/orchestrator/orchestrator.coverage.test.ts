import { afterEach, describe, expect, mock, test } from "bun:test";
import { Orchestrator } from "../orchestrator";

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

describe("Orchestrator additional coverage", () => {
  afterEach(() => {
    mock.restore();
  });

  test("triggerScheduled rejects non-scheduled tasks", async () => {
    const task = makeTask({ status: "in_progress" });
    const mockDb = {
      tasks: {
        getById: mock().mockReturnValue(task),
      },
    };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, {} as any, 2);

    await expect(orch.triggerScheduled(task.id)).rejects.toThrow("Invalid template task");
  });

  test("triggerScheduled respects concurrency limit", async () => {
    const task = makeTask({ status: "scheduled" });
    const mockDb = {
      tasks: {
        getById: mock().mockReturnValue(task),
        list: mock().mockReturnValue([{ id: "t1" }, { id: "t2" }]),
      },
    };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, {} as any, 1);
    (orch as any).activeRuns.set("t1", {});

    await expect(orch.triggerScheduled(task.id)).rejects.toThrow("Max concurrent agents reached");
  });

  test("triggerScheduled throws if already running", async () => {
    const template = makeTask({ id: "template-1", status: "scheduled" });
    const mockDb = {
      tasks: {
        getById: mock().mockReturnValue(template),
        list: mock().mockReturnValue([]),
      },
    };

    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, {} as any, 2);
    (orch as any).activeRuns.set("template-1", { taskId: "template-1" });

    await expect(orch.triggerScheduled(template.id)).rejects.toThrow("already running");
  });

  test("sendInput handles active run", () => {
    const activeRun = { runId: "r1", taskId: "t1", engineName: "e1" };
    const mockEngine = { sendInput: mock().mockReturnValue(true) };
    const mockRegistry = { get: mock().mockReturnValue(mockEngine) };
    const mockDb = { logs: { create: mock() } };
    const mockHub = { broadcastToTask: mock() };

    const orch = new Orchestrator(mockDb as any, {} as any, mockRegistry as any, mockHub as any, 2);
    (orch as any).activeRuns.set("t1", activeRun);

    const result = orch.sendInput("t1", "input text");

    expect(result).toBe(true);
    expect(mockEngine.sendInput).toHaveBeenCalledWith("r1", "input text");
    expect(mockDb.logs.create).toHaveBeenCalledWith("r1", "stdin", "input text");
    expect(mockHub.broadcastToTask).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ stream: "stdin", content: "input text" })
    );
  });

  test("sendInput returns false if no active run", () => {
    const orch = new Orchestrator({} as any, {} as any, {} as any, {} as any, 2);
    const result = orch.sendInput("nonexistent", "input text");
    expect(result).toBe(false);
  });

  test("maybeScheduleRetry executes retry logic successfully", async () => {
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    let timeoutCb: any;
    (global as any).setTimeout = (cb: any, _ms: any) => {
      timeoutCb = cb;
      return 123;
    };
    (global as any).clearTimeout = () => {};

    const task = makeTask({ id: "t1", status: "failed", notes: "" });
    let t1Status = "failed";

    const mockDb = {
      tasks: {
        getById: mock().mockImplementation(() => task),
        update: mock().mockImplementation((id: string, data: Record<string, unknown>) => {
          if (id === "t1" && data.status) {
            t1Status = data.status as string;
            task.status = data.status as string;
          }
          return { id, ...data };
        }),
      },
      runs: {
        getLatestByTask: mock().mockReturnValue({ errorMessage: "some error" }),
      },
    };

    const mockHub = { broadcastAll: mock() };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, mockHub as any, 1);

    orch.launch = mock().mockResolvedValue({});

    (orch as any).maybeScheduleRetry("t1");

    if (timeoutCb) {
      await timeoutCb();
    }

    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;

    expect(t1Status).toBe("backlog");
    expect(orch.launch).toHaveBeenCalled();
  });

  test("maybeScheduleRetry exceeds max retries and blocks task", async () => {
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    (global as any).setTimeout = (_cb: any, _ms: any) => 123;
    (global as any).clearTimeout = () => {};

    const task = makeTask({ id: "t1", status: "failed", notes: "" });
    let t1Status = "failed";

    const mockDb = {
      tasks: {
        getById: mock().mockImplementation(() => task),
        update: mock().mockImplementation((id: string, data: Record<string, unknown>) => {
          if (id === "t1" && data.status) t1Status = data.status as string;
          return { id, ...data };
        }),
      },
      runs: {
        getLatestByTask: mock().mockReturnValue({ errorMessage: "some error" }),
      },
    };

    const mockHub = { broadcastAll: mock() };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, mockHub as any, 1);

    // Default AUTO_RETRY_MAX is 2 if not set by env, but if it is 0, it blocks immediately.
    // If it's > 0, we can force a block by setting retry attempts arbitrarily high:
    (orch as any).retryAttempts.set("t1", 999);

    (orch as any).maybeScheduleRetry("t1");

    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;

    expect(t1Status).toBe("blocked");
  });

  test("cancel method covers un-active run properly", async () => {
    const task = makeTask({ id: "t1", status: "in_progress" });
    const childTask = makeTask({ id: "t-child", status: "in_progress" });

    let t1Status = "in_progress";

    const mockDb = {
      tasks: {
        getById: mock().mockImplementation((id: string) => {
          if (id === "t1") return task;
          if (id === "t-child") return childTask;
          return null;
        }),
        update: mock().mockImplementation((id: string, data: Record<string, unknown>) => {
          if (id === "t1" && data.status) t1Status = data.status as string;
          return { id, ...data };
        }),
        listChildren: mock().mockImplementation((id: string) => {
          if (id === "t1") return [childTask];
          return [];
        }),
      },
      runs: {
        updateStatus: mock(),
      },
    };

    const mockHub = { broadcastAll: mock() };
    const mockRegistry = { get: mock() };

    const orch = new Orchestrator(mockDb as any, {} as any, mockRegistry as any, mockHub as any, 2);

    await orch.cancel("t1");
    expect(t1Status).toBe("backlog");
  });

  test("recoverInProgressTasks promotes top maxConcurrent tasks to backlog", async () => {
    const task1 = makeTask({ id: "t1", priority: "high" });
    const task2 = makeTask({ id: "t2", priority: "medium" });
    const task3 = makeTask({ id: "t3", priority: "low" });

    const mockDb = {
      tasks: {
        list: mock().mockReturnValue([task1, task2, task3]),
        update: mock(),
      },
    };
    const mockHub = { broadcastAll: mock() };

    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, mockHub as any, 2);
    await orch.recoverInProgressTasks();

    expect(mockDb.tasks.update).toHaveBeenCalledWith("t1", { status: "blocked" });
    expect(mockDb.tasks.update).toHaveBeenCalledWith("t2", { status: "blocked" });
    expect(mockDb.tasks.update).toHaveBeenCalledWith("t3", { status: "blocked" });

    expect(mockDb.tasks.update).toHaveBeenCalledWith("t1", { status: "backlog" });
    expect(mockDb.tasks.update).toHaveBeenCalledWith("t2", { status: "backlog" });
    expect(mockDb.tasks.update).not.toHaveBeenCalledWith("t3", { status: "backlog" });
  });

  test("unblockTask works correctly", async () => {
    const task = makeTask({ id: "t1", status: "blocked" });

    const mockDb = {
      tasks: {
        getById: mock().mockReturnValue(task),
        update: mock(),
        list: mock().mockReturnValue([]),
      },
    };
    const mockHub = { broadcastAll: mock() };

    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, mockHub as any, 2);
    orch.sweepBacklog = mock().mockResolvedValue(undefined);

    await orch.unblockTask("t1");

    expect(mockDb.tasks.update).toHaveBeenCalledWith("t1", { status: "backlog" });
    expect(orch.sweepBacklog).toHaveBeenCalled();
  });

  test("checkLoopAndRelaunch handles loop logic successfully", async () => {
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    let timeoutCb: any;
    (global as any).setTimeout = (cb: any, _ms: any) => {
      timeoutCb = cb;
      return 123;
    };
    (global as any).clearTimeout = () => {};

    const task = makeTask({
      id: "t1",
      status: "error",
      loopConfig: { enabled: true, currentAttempt: 0, maxAttempts: 3 },
    });

    const mockDb = {
      tasks: {
        getById: mock().mockImplementation(() => task),
        incrementLoopAttempt: mock(),
        update: mock().mockImplementation((id: string, data: Record<string, unknown>) => {
          if (id === "t1" && data.status) task.status = data.status as string;
          return { id, ...data };
        }),
      },
    };

    const mockHub = { broadcastAll: mock() };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, mockHub as any, 1);

    orch.launch = mock().mockResolvedValue({});

    (orch as any).checkLoopAndRelaunch("t1");

    if (timeoutCb) {
      await timeoutCb();
    }

    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;

    expect(mockDb.tasks.incrementLoopAttempt).toHaveBeenCalledWith("t1");
    expect(task.status).toBe("backlog");
    expect(orch.launch).toHaveBeenCalled();
  });
});
