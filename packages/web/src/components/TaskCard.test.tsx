import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaskWithRun } from "@vibe-code/shared";
import { describe, expect, it, vi } from "vitest";
import { TaskCard } from "./TaskCard";

// dnd-kit requires a DndContext — stub the hook so tests stay isolated
vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock("../hooks/useElapsedTime", () => ({
  useElapsedTime: () => null,
}));

const baseTask: TaskWithRun = {
  id: "abc12345-0000-0000-0000-000000000000",
  title: "My Task Title",
  description: "Some description",
  repoId: "repo-1",
  status: "backlog",
  engine: "claude-code",
  model: null,
  priority: 0,
  columnOrder: 0,
  baseBranch: null,
  branchName: "feat/my-branch",
  prUrl: null,
  parentTaskId: null,
  agentId: null,
  workflowId: null,
  matchedSkills: [],
  tags: [],
  notes: "",
  dependsOn: [],
  pendingApproval: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  latestRun: undefined,
  repo: {
    id: "repo-1",
    name: "my-repo",
    url: "https://github.com/org/repo",
    defaultBranch: "main",
    localPath: "/tmp",
    status: "ready",
    errorMessage: null,
    provider: "github",
    createdAt: "",
    updatedAt: "",
  },
};

describe("TaskCard", () => {
  it("renders the task title", () => {
    render(<TaskCard task={baseTask} onClick={vi.fn()} onRetryPR={vi.fn()} />);
    expect(screen.getByText("My Task Title")).toBeInTheDocument();
  });

  it("renders the short task id", () => {
    render(<TaskCard task={baseTask} onClick={vi.fn()} onRetryPR={vi.fn()} />);
    expect(screen.getByText("abc12345")).toBeInTheDocument();
  });

  it("renders the engine badge", () => {
    render(<TaskCard task={baseTask} onClick={vi.fn()} onRetryPR={vi.fn()} />);
    expect(screen.getByText("claude-code")).toBeInTheDocument();
  });

  it("calls onClick when card is clicked", async () => {
    const onClick = vi.fn();
    render(<TaskCard task={baseTask} onClick={onClick} onRetryPR={vi.fn()} />);
    await userEvent.click(screen.getByText("My Task Title"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows PR link when prUrl is set", () => {
    const task = { ...baseTask, prUrl: "https://github.com/org/repo/pull/1" };
    render(<TaskCard task={task} onClick={vi.fn()} onRetryPR={vi.fn()} />);
    const link = screen.getByRole("link", { name: /↗ PR/i });
    expect(link).toHaveAttribute("href", "https://github.com/org/repo/pull/1");
  });

  it("shows Retry PR button when status is review and no prUrl", () => {
    const task = { ...baseTask, status: "review" as const };
    render(<TaskCard task={task} onClick={vi.fn()} onRetryPR={vi.fn()} />);
    expect(screen.getByRole("button", { name: /retry pr/i })).toBeInTheDocument();
  });

  it("shows Failed badge when status is failed", () => {
    const task = { ...baseTask, status: "failed" as const };
    render(<TaskCard task={task} onClick={vi.fn()} onRetryPR={vi.fn()} />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
