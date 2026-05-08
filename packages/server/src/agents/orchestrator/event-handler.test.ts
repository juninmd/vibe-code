import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { AgentEvent } from "../engine";
import { handleAgentEvent } from "./event-handler";

mock.module("./terminal-logger", () => ({
  logAgentEvent: mock(),
}));

const mockDb = {
  logs: {
    create: mock(),
  },
  runs: {
    getById: mock(),
    updateStatus: mock(),
    updateCostStats: mock(),
    updateSessionId: mock(),
  },
  settings: {
    get: mock(),
  },
} as any;

const mockHub = {
  broadcastToTask: mock(),
  batchLog: mock(),
  broadcastAll: mock(),
} as any;

describe("handleAgentEvent", () => {
  beforeEach(() => {
    mockDb.logs.create.mockClear();
    mockDb.runs.getById.mockClear();
    mockDb.runs.updateStatus.mockClear();
    mockDb.runs.updateCostStats.mockClear();
    mockDb.runs.updateSessionId.mockClear();
    mockDb.settings.get.mockClear();
    mockDb.settings.get.mockReturnValue("false");
    mockHub.broadcastToTask.mockClear();
    mockHub.batchLog.mockClear();
    mockHub.broadcastAll.mockClear();
  });

  describe("run not found scenarios", () => {
    it("handles events when run is missing without crashing", async () => {
      mockDb.runs.getById.mockReturnValue(undefined);

      const logEvent: AgentEvent = {
        type: "log",
        stream: "stdout",
        content: "Hello",
      };

      await handleAgentEvent(logEvent, "run-not-found", "task-1", mockDb, mockHub, mock());
      expect(mockDb.logs.create).toHaveBeenCalled();
    });
  });

  it("handles log event correctly", async () => {
    const event: AgentEvent = { type: "log", stream: "stdout", content: "Log content" };
    await handleAgentEvent(event, "run-1", "task-1", mockDb, mockHub, mock());

    expect(mockDb.logs.create).toHaveBeenCalledWith("run-1", "stdout", "Log content");
    expect(mockHub.batchLog).toHaveBeenCalled();
  });

  it("handles error event correctly", async () => {
    const event: AgentEvent = { type: "error", content: "Error message" };
    await handleAgentEvent(event, "run-1", "task-1", mockDb, mockHub, mock());

    expect(mockDb.logs.create).toHaveBeenCalledWith("run-1", "stderr", "Error message");
    expect(mockHub.batchLog).toHaveBeenCalled();
  });

  it("handles status event correctly", async () => {
    const event: AgentEvent = { type: "status", content: "Thinking" };
    mockDb.runs.getById.mockReturnValue({ status: "running" });
    mockDb.runs.updateStatus.mockReturnValue({ status: "running", current_status: "Thinking" });

    const onActivity = mock();
    await handleAgentEvent(event, "run-1", "task-1", mockDb, mockHub, onActivity);

    expect(mockDb.runs.updateStatus).toHaveBeenCalledWith("run-1", "running", {
      current_status: "Thinking",
    });
    expect(mockHub.broadcastAll).toHaveBeenCalled();
    expect(onActivity).toHaveBeenCalled();
  });

  it("handles cost event correctly", async () => {
    const costStats = { total_tokens: 10, input_tokens: 5, output_tokens: 5 };
    const event: AgentEvent = { type: "cost", content: "Cost update", costStats };
    mockDb.runs.getById.mockReturnValue({ status: "running" });

    const onActivity = mock();
    await handleAgentEvent(event, "run-1", "task-1", mockDb, mockHub, onActivity);

    expect(mockDb.runs.updateCostStats).toHaveBeenCalledWith("run-1", costStats);
    expect(mockHub.broadcastAll).toHaveBeenCalled();
    expect(onActivity).toHaveBeenCalled();
  });

  it("handles session event correctly", async () => {
    const event: AgentEvent = { type: "session", sessionId: "session-123" };
    mockDb.runs.getById.mockReturnValue({ status: "running", sessionId: "session-123" });
    await handleAgentEvent(event, "run-1", "task-1", mockDb, mockHub, mock());

    expect(mockDb.runs.updateSessionId).toHaveBeenCalledWith("run-1", "session-123");
    expect(mockHub.broadcastAll).toHaveBeenCalled();
  });

  it("handles tool_use event correctly", async () => {
    const event: AgentEvent = {
      type: "tool_use",
      toolUse: { toolId: "t1", toolName: "bash", parameters: { command: "ls" } },
    };
    await handleAgentEvent(event, "run-1", "task-1", mockDb, mockHub, mock());

    expect(mockHub.broadcastToTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        type: "agent_tool_use",
        toolId: "t1",
        toolName: "bash",
      })
    );
  });

  it("handles tool_result event correctly", async () => {
    const event: AgentEvent = {
      type: "tool_result",
      toolResult: { toolId: "t1", output: "file1 file2", status: "success" },
    };
    await handleAgentEvent(event, "run-1", "task-1", mockDb, mockHub, mock());

    expect(mockHub.broadcastToTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        type: "agent_tool_result",
        toolId: "t1",
        output: "file1 file2",
      })
    );
  });
});
