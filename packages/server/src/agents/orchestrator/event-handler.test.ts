import { describe, expect, it, mock } from "bun:test";
import type { Db } from "../../db";
import type { BroadcastHub } from "../../ws/broadcast";
import type { AgentEvent } from "../engine";
import { handleAgentEvent } from "./event-handler";

describe("handleAgentEvent", () => {
  const mockDb = {
    logs: {
      create: mock(() => {}),
    },
    runs: {
      getById: mock(() => ({ id: "run1", status: "running" })),
      updateStatus: mock(() => ({ id: "run1", status: "running", current_status: "new status" })),
      updateCostStats: mock(() => {}),
      updateSessionId: mock(() => {}),
    },
  } as unknown as Db;

  const mockHub = {
    batchLog: mock(() => {}),
    broadcastAll: mock(() => {}),
    broadcastToTask: mock(() => {}),
  } as unknown as BroadcastHub;

  it("handles log event correctly", async () => {
    const event: AgentEvent = { type: "log", stream: "stdout", content: "test log" };
    const onActivity = mock(() => {});

    await handleAgentEvent(event, "run1", "task1", mockDb, mockHub, onActivity);

    expect(onActivity).toHaveBeenCalled();
    expect(mockDb.logs.create).toHaveBeenCalledWith("run1", "stdout", "test log");
    expect(mockHub.batchLog).toHaveBeenCalledWith(
      "task1",
      "run1",
      "stdout",
      "test log",
      expect.any(String)
    );
  });

  it("handles error event correctly", async () => {
    const event: AgentEvent = { type: "error", content: "test error" };
    const onActivity = mock(() => {});

    await handleAgentEvent(event, "run1", "task1", mockDb, mockHub, onActivity);

    expect(onActivity).toHaveBeenCalled();
    expect(mockDb.logs.create).toHaveBeenCalledWith("run1", "stderr", "test error");
    expect(mockHub.batchLog).toHaveBeenCalledWith(
      "task1",
      "run1",
      "stderr",
      "test error",
      expect.any(String)
    );
  });

  it("handles status event correctly", async () => {
    const event: AgentEvent = { type: "status", content: "Working..." };
    const onActivity = mock(() => {});

    await handleAgentEvent(event, "run1", "task1", mockDb, mockHub, onActivity);

    expect(onActivity).toHaveBeenCalled();
    expect(mockDb.runs.getById).toHaveBeenCalledWith("run1");
    expect(mockDb.runs.updateStatus).toHaveBeenCalledWith("run1", "running", {
      current_status: "Working...",
    });
    expect(mockHub.broadcastAll).toHaveBeenCalledWith({
      type: "run_updated",
      run: expect.objectContaining({ current_status: "new status" }),
    });
  });

  it("handles cost event correctly", async () => {
    const event: AgentEvent = {
      type: "cost",
      costStats: { total_tokens: 100, input_tokens: 50, output_tokens: 50 },
    };
    const onActivity = mock(() => {});

    await handleAgentEvent(event, "run1", "task1", mockDb, mockHub, onActivity);

    expect(onActivity).not.toHaveBeenCalled(); // cost event doesn't trigger onActivity unless it has content, but type limits it
    expect(mockDb.runs.updateCostStats).toHaveBeenCalledWith("run1", {
      total_tokens: 100,
      input_tokens: 50,
      output_tokens: 50,
    });
    expect(mockHub.broadcastAll).toHaveBeenCalledWith({
      type: "run_updated",
      run: expect.objectContaining({
        id: "run1",
        costStats: { total_tokens: 100, input_tokens: 50, output_tokens: 50 },
      }),
    });
  });

  it("handles session event correctly", async () => {
    const event: AgentEvent = { type: "session", sessionId: "sess_123" };

    await handleAgentEvent(event, "run1", "task1", mockDb, mockHub);

    expect(mockDb.runs.updateSessionId).toHaveBeenCalledWith("run1", "sess_123");
    expect(mockHub.broadcastAll).toHaveBeenCalledWith({
      type: "run_updated",
      run: expect.objectContaining({ id: "run1", status: "running" }),
    });
  });

  it("handles tool_use event correctly", async () => {
    const event: AgentEvent = {
      type: "tool_use",
      toolUse: { toolId: "tool1", toolName: "bash", parameters: { cmd: "ls" } },
    };
    const onActivity = mock(() => {});

    await handleAgentEvent(event, "run1", "task1", mockDb, mockHub, onActivity);

    expect(onActivity).toHaveBeenCalled();
    expect(mockHub.broadcastToTask).toHaveBeenCalledWith(
      "task1",
      expect.objectContaining({
        type: "agent_tool_use",
        runId: "run1",
        taskId: "task1",
        toolId: "tool1",
        toolName: "bash",
        parameters: { cmd: "ls" },
        timestamp: expect.any(String),
      })
    );
  });

  it("handles tool_result event correctly", async () => {
    const event: AgentEvent = {
      type: "tool_result",
      toolResult: { toolId: "tool1", output: "success", status: "success" },
    };

    await handleAgentEvent(event, "run1", "task1", mockDb, mockHub);

    expect(mockHub.broadcastToTask).toHaveBeenCalledWith(
      "task1",
      expect.objectContaining({
        type: "agent_tool_result",
        runId: "run1",
        taskId: "task1",
        toolId: "tool1",
        output: "success",
        status: "success",
        timestamp: expect.any(String),
      })
    );
  });

  describe("run not found scenarios", () => {
    it("handles events when run is missing without crashing", async () => {
      const localMockDb = {
        ...mockDb,
        runs: {
          ...mockDb.runs,
          getById: mock(() => undefined),
          updateCostStats: mock(() => {}),
          updateSessionId: mock(() => {}),
        },
      } as unknown as Db;

      await handleAgentEvent(
        { type: "status", content: "Working..." },
        "run1",
        "task1",
        localMockDb,
        mockHub
      );
      expect(localMockDb.runs.getById).toHaveBeenCalledWith("run1");

      await handleAgentEvent(
        { type: "cost", costStats: { total_tokens: 100, input_tokens: 50, output_tokens: 50 } },
        "run1",
        "task1",
        localMockDb,
        mockHub
      );
      expect(localMockDb.runs.updateCostStats).toHaveBeenCalledWith("run1", {
        total_tokens: 100,
        input_tokens: 50,
        output_tokens: 50,
      });

      await handleAgentEvent(
        { type: "session", sessionId: "sess_123" },
        "run1",
        "task1",
        localMockDb,
        mockHub
      );
      expect(localMockDb.runs.updateSessionId).toHaveBeenCalledWith("run1", "sess_123");
    });
  });
});
