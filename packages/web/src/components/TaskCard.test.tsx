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
  priority: "none",
  columnOrder: 0,
  baseBranch: null,
  branchName: "feat/my-branch",
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

  it("keeps the card minimal: no id, description or tags", () => {
    const task = { ...baseTask, tags: ["frontend"], description: "Long description text" };
    render(<TaskCard task={task} onClick={vi.fn()} onRetryPR={vi.fn()} />);
    expect(screen.queryByText("abc1")).not.toBeInTheDocument();
    expect(screen.queryByText("Long description text")).not.toBeInTheDocument();
    expect(screen.queryByText("#frontend")).not.toBeInTheDocument();
  });

  it("identifies the engine and repository", () => {
    render(<TaskCard task={baseTask} onClick={vi.fn()} onRetryPR={vi.fn()} />);
    expect(screen.getByTitle("claude-code")).toBeInTheDocument();
    expect(screen.getByText("my-repo")).toBeInTheDocument();
  });

  it("calls onClick when card is clicked", async () => {
    const onClick = vi.fn();
    render(<TaskCard task={baseTask} onClick={onClick} onRetryPR={vi.fn()} />);
    await userEvent.click(screen.getByText("My Task Title"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows PR badge when prUrl is set", () => {
    const task = { ...baseTask, prUrl: "https://github.com/org/repo/pull/1" };
    render(<TaskCard task={task} onClick={vi.fn()} onRetryPR={vi.fn()} />);
    expect(screen.getByText("PR")).toBeInTheDocument();
  });

  it("offers Create PR when the task is in review without a PR", async () => {
    const onRetryPR = vi.fn();
    const onClick = vi.fn();
    const task = { ...baseTask, status: "review" as const };
    render(<TaskCard task={task} onClick={onClick} onRetryPR={onRetryPR} />);
    await userEvent.click(screen.getByRole("button", { name: /create pr/i }));
    expect(onRetryPR).toHaveBeenCalledWith(task.id);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a live indicator while the terminal session runs", () => {
    const task = {
      ...baseTask,
      status: "in_progress" as const,
      latestRun: { ...({} as NonNullable<TaskWithRun["latestRun"]>), status: "running" as const },
    };
    render(<TaskCard task={task} onClick={vi.fn()} onRetryPR={vi.fn()} />);
    expect(screen.getByText("live")).toBeInTheDocument();
  });

  it("shows Failed badge when status is failed", () => {
    const task = { ...baseTask, status: "failed" as const };
    render(<TaskCard task={task} onClick={vi.fn()} onRetryPR={vi.fn()} />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("links to the issue the card came from without opening the task", async () => {
    const onClick = vi.fn();
    const task = { ...baseTask, issueUrl: "https://github.com/o/r/issues/42" };
    render(<TaskCard task={task} onClick={onClick} onRetryPR={vi.fn()} />);

    const link = screen.getByRole("link", { name: "#42" });
    expect(link).toHaveAttribute("href", "https://github.com/o/r/issues/42");
    await userEvent.click(link);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("reads GitLab issue numbers too", () => {
    const task = { ...baseTask, issueUrl: "https://gitlab.com/g/p/-/issues/7" };
    render(<TaskCard task={task} onClick={vi.fn()} onRetryPR={vi.fn()} />);
    expect(screen.getByRole("link", { name: "#7" })).toBeInTheDocument();
  });

  it("never turns a non-web issue URL into a link", () => {
    const task = { ...baseTask, issueUrl: "javascript:alert(1)//issues/9" };
    render(<TaskCard task={task} onClick={vi.fn()} onRetryPR={vi.fn()} />);
    expect(screen.queryByRole("link", { name: "#9" })).not.toBeInTheDocument();
  });
});
