import { describe, expect, it, mock, spyOn } from "bun:test";
import { Orchestrator } from "./orchestrator";

describe("Orchestrator - edge cases", () => {
  it("getActiveRunDetails handles invalid stateSnapshot gracefully", () => {
    const mockDb = {
      runs: {
        getById: mock().mockReturnValue({
          id: "run-1",
          stateSnapshot: "invalid-json-{",
        }),
      },
      tasks: { list: mock().mockReturnValue([]) },
    };

    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, {} as any);
    // biome-ignore lint/complexity/useLiteralKeys: private access
    orch["activeRuns"].set("task-1", {
      runId: "run-1",
      taskId: "task-1",
      engineName: "test",
      abort: new AbortController(),
    });

    const details = orch.getActiveRunDetails();
    expect(details).toHaveLength(1);
    expect(details[0].phase).toBeNull();
  });

  it("cancel deletes the active run and aborts even if engine fails to abort", async () => {
    const mockDb = {
      tasks: {
        listChildren: mock().mockReturnValue([]),
        update: mock(),
        list: mock().mockReturnValue([]),
      },
      runs: { updateStatus: mock() },
    };
    const mockHub = { broadcastAll: mock() };
    const mockEngine = {
      abort: mock().mockImplementation(() => {
        throw new Error("abort error");
      }),
    };
    const mockRegistry = { get: mock().mockReturnValue(mockEngine) };

    const orch = new Orchestrator(mockDb as any, {} as any, mockRegistry as any, mockHub as any);
    const abortController = new AbortController();
    // biome-ignore lint/complexity/useLiteralKeys: private access
    orch["activeRuns"].set("task-1", {
      runId: "run-1",
      taskId: "task-1",
      engineName: "test",
      abort: abortController,
    });

    try {
      await orch.cancel("task-1");
    } catch {
      // should catch but let's check expectations anyway
    }

    expect(abortController.signal.aborted).toBe(true);
    expect(
      // biome-ignore lint/complexity/useLiteralKeys: private access
      orch["activeRuns"].has("task-1")
    ).toBe(false);
  });

  it("sweepBacklog catches errors from launch and continues", async () => {
    const mockDb = {
      tasks: {
        list: mock().mockReturnValue([{ id: "t-1", priority: "low", dependsOn: [] }]),
      },
    };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, {} as any);

    // override launch to throw
    orch.launch = mock().mockRejectedValue(new Error("Launch error"));

    // should not throw
    await orch.sweepBacklog();
  });

  it("launch throws when task limit is reached via maxCost check", async () => {
    const mockDb = {
      runs: {
        listByTask: mock().mockReturnValue([
          {
            tokenUsage: {
              modelA: { total_cost: 0.5 },
              modelB: { total_cost: 0.6 },
            },
          },
        ]),
      },
      tasks: { list: mock().mockReturnValue([]) },
    };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, {} as any);

    const task = { id: "t-1", maxCost: 1.0, dependsOn: [] };
    await expect(orch.launch(task as any)).rejects.toThrow(/Task cost limit exceeded/);
  });

  it("triggerScheduled throws if template task is not scheduled", async () => {
    const mockDb = {
      tasks: {
        getById: mock().mockReturnValue({ id: "t-1", status: "backlog" }),
        list: mock().mockReturnValue([]),
      },
    };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, {} as any);
    await expect(orch.triggerScheduled("t-1")).rejects.toThrow(/Invalid template task/);
  });

  it("triggerScheduled throws if capacity is exceeded", async () => {
    const mockDb = {
      tasks: {
        getById: mock().mockReturnValue({ id: "t-1", status: "scheduled" }),
        list: mock().mockReturnValue([
          { id: "mock1" },
          { id: "mock2" },
          { id: "mock3" },
          { id: "mock4" },
          { id: "mock5" },
        ]), // Forces activeCount to 5
      },
    };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, {} as any, 1); // 1 maxConcurrent
    await expect(orch.triggerScheduled("t-1")).rejects.toThrow(/Max concurrent agents reached/);
  });

  it("triggerScheduled throws if derived task already running", async () => {
    const mockDb = {
      tasks: {
        getById: mock().mockReturnValue({
          id: "t-1",
          status: "scheduled",
          parentTaskId: "t-template",
        }),
        list: mock().mockReturnValue([]),
      },
    };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, {} as any, 5);
    // biome-ignore lint/complexity/useLiteralKeys: private access
    orch["activeRuns"].set("t-1", {
      runId: "r-1",
      taskId: "t-1",
      engineName: "mock",
      abort: new AbortController(),
    });

    await expect(orch.triggerScheduled("t-template")).rejects.toThrow(
      /A derived task from this template is already running/
    );
  });

  it("sendInput returns false if task not active or engine missing", () => {
    const mockDb = { tasks: { list: mock().mockReturnValue([]) } };
    const orch = new Orchestrator(mockDb as any, {} as any, { get: () => null } as any, {} as any);
    expect(orch.sendInput("t-missing", "input")).toBe(false);

    // biome-ignore lint/complexity/useLiteralKeys: private access
    orch["activeRuns"].set("t-active", {
      runId: "r-1",
      taskId: "t-active",
      engineName: "mock",
      abort: new AbortController(),
    });
    expect(orch.sendInput("t-active", "input")).toBe(false); // engine missing returns false
  });

  it("getRetryQueueSnapshot returns the snapshot correctly", () => {
    const mockDb = { tasks: { list: mock().mockReturnValue([]) } };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, {} as any);
    // biome-ignore lint/complexity/useLiteralKeys: private access
    orch["retryQueue"].set("t-1", {
      attempt: 2,
      dueAt: Date.now() + 10000,
      reason: "Testing",
      timer: setTimeout(() => {}, 1),
    });
    const snapshot = orch.getRetryQueueSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].taskId).toBe("t-1");
    expect(snapshot[0].attempt).toBe(2);
    expect(snapshot[0].reason).toBe("Testing");
  });

  it("getActiveRunEngines returns mapping of active runs", () => {
    const mockDb = { tasks: { list: mock().mockReturnValue([]) } };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, {} as any);
    // biome-ignore lint/complexity/useLiteralKeys: private access
    orch["activeRuns"].set("t-1", {
      runId: "r-1",
      taskId: "t-1",
      engineName: "engineA",
      abort: new AbortController(),
    });
    // biome-ignore lint/complexity/useLiteralKeys: private access
    orch["activeRuns"].set("t-2", {
      runId: "r-2",
      taskId: "t-2",
      engineName: "engineB",
      abort: new AbortController(),
    });
    const engines = orch.getActiveRunEngines();
    expect(engines.get("t-1")).toBe("engineA");
    expect(engines.get("t-2")).toBe("engineB");
  });

  it("setMaxConcurrent sets limits", () => {
    const mockDb = { tasks: { list: mock().mockReturnValue([]) } };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, {} as any);
    orch.setMaxConcurrent(10);
    expect(orch.maxConcurrentAgents).toBe(10);
    orch.setMaxConcurrent(-5); // Will be clamped to 1
    expect(orch.maxConcurrentAgents).toBe(1);
    orch.setMaxConcurrent(100); // Will be clamped to 50
    expect(orch.maxConcurrentAgents).toBe(50);
  });

  it("shutdown triggers cancel for all active runs", async () => {
    // For test coverage, we emit SIGTERM and mock process.exit.
    // However, that might break the test runner, so we invoke the listener manually.
    const mockDb = { tasks: { list: mock().mockReturnValue([]) } };
    const orch = new Orchestrator(mockDb as any, {} as any, {} as any, {} as any);

    spyOn(orch, "cancel").mockResolvedValue(undefined);
    // biome-ignore lint/complexity/useLiteralKeys: private access
    orch["activeRuns"].set("task-1", {
      runId: "run-1",
      taskId: "task-1",
      engineName: "mock",
      abort: new AbortController(),
    });
    // biome-ignore lint/complexity/useLiteralKeys: private access
    orch["activeRuns"].set("task-2", {
      runId: "run-2",
      taskId: "task-2",
      engineName: "mock",
      abort: new AbortController(),
    });

    // We can't easily emit SIGTERM without risking shutting down bun test.
    // But we can extract the registered listeners if we really wanted to.
    const listeners = process.listeners("SIGTERM");
    expect(listeners.length).toBeGreaterThan(0);

    // As a hack to hit lines 70-87, we run it
    const originalExit = process.exit;
    process.exit = mock() as any;

    // simulate
    try {
      await (listeners[listeners.length - 1] as any)();
    } catch {}

    expect(orch.cancel).toHaveBeenCalledWith("task-1");
    expect(orch.cancel).toHaveBeenCalledWith("task-2");

    process.exit = originalExit;
  });
});
