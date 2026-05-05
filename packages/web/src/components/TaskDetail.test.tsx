import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaskWithRun } from "@vibe-code/shared";
import { describe, expect, it, vi } from "vitest";
import { TaskDetail } from "./TaskDetail";

vi.mock("../api/client", () => ({
  api: {
    tasks: {
      matchedSkills: vi.fn().mockResolvedValue([]),
      artifacts: vi.fn().mockResolvedValue([]),
      previewPrompt: vi.fn().mockResolvedValue({ prompt: "" }),
      downloadUrl: vi.fn().mockReturnValue("/download/mock"),
      openEditor: vi.fn().mockResolvedValue({ ok: true }),
      getMemory: vi.fn().mockResolvedValue({ memory: "", scope: "task", needsCompaction: false }),
      updateMemory: vi.fn().mockResolvedValue({ memory: "", needsCompaction: false }),
    },
    engines: {
      models: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("../hooks/useElapsedTime", () => ({
  useElapsedTime: () => null,
}));

vi.mock("./ExecutionTimeline", () => ({
  ExecutionTimeline: () => <div>execution-timeline-mock</div>,
}));

vi.mock("./TerminalSessionPanel", () => ({
  TerminalSessionPanel: () => <div>terminal-session-mock</div>,
}));

const baseTask: TaskWithRun = {
  id: "task-1",
  title: "Execution split",
  description: "",
  repoId: "repo-1",
  status: "in_progress",
  engine: "claude-code",
  model: null,
  priority: "none",
  columnOrder: 0,
  baseBranch: null,
  branchName: null,
  prUrl: null,
  issueUrl: null,
  parentTaskId: null,
  agentId: null,
  workflowId: null,
  matchedSkills: [],
  tags: [],
  notes: "",
  dependsOn: [],
  pendingApproval: false,
  goal: null,
  desiredOutcome: null,
  maxCost: undefined,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  latestRun: {
    id: "run-1",
    taskId: "task-1",
    engine: "claude-code",
    status: "running",
    currentStatus: "agent_running",
    worktreePath: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    costStats: undefined,
    sessionId: null,
  },
};

describe("TaskDetail tabs", () => {
  function renderDetail(task: TaskWithRun = baseTask) {
    return render(
      <TaskDetail
        task={task}
        liveLogs={[]}
        onClose={vi.fn()}
        onLaunch={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn().mockResolvedValue(undefined)}
        onRetry={vi.fn().mockResolvedValue(undefined)}
        onRetryPR={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onSendInput={vi.fn()}
      />
    );
  }

  it("opens in execution tab for running tasks", () => {
    renderDetail();
    expect(screen.getByText("execution-timeline-mock")).toBeInTheDocument();
  });

  it("switches to terminal tab when terminal tab is clicked", async () => {
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: "TERMINAL" }));
    expect(screen.getByText("terminal-session-mock")).toBeInTheDocument();
  });
});
