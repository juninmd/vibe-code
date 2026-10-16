// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { TaskWithRun } from "@vibe-code/shared";
import { describe, expect, it, vi } from "vitest";
import { SessionGrid } from "./SessionGrid";

vi.mock("../../hooks/useElapsedTime", () => ({
  useElapsedTime: () => null,
}));

function repo(name: string) {
  return {
    id: `repo-${name}`,
    name,
    url: `https://github.com/org/${name}`,
    defaultBranch: "main",
    localPath: "/tmp",
    status: "ready" as const,
    errorMessage: null,
    provider: "github" as const,
    createdAt: "",
    updatedAt: "",
  };
}

function task(overrides: Partial<TaskWithRun> = {}): TaskWithRun {
  return {
    id: "t1",
    title: "Fix the login bug",
    description: "the login form rejects valid tokens",
    repoId: "repo-1",
    status: "in_progress",
    engine: "claude-code",
    model: null,
    priority: "none",
    columnOrder: 0,
    baseBranch: null,
    branchName: "main",
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
    repo: repo("vibe-code"),
    ...overrides,
  };
}

const grid = (tasks: TaskWithRun[], onStop = vi.fn()) => (
  <SessionGrid tasks={tasks} onOpen={vi.fn()} onStop={onStop} />
);

describe("SessionGrid", () => {
  it("shows the live count and a card per session", () => {
    render(grid([task(), task({ id: "t2", title: "Second session" })]));

    expect(screen.getByRole("heading", { name: /Live now/ })).toBeInTheDocument();
    expect(screen.getByText("Fix the login bug")).toBeInTheDocument();
    expect(screen.getByText("Second session")).toBeInTheDocument();
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
  });

  it("filters sessions with the search box", () => {
    render(
      grid([
        task(),
        task({ id: "t2", title: "Unrelated work", description: "a totally different thing" }),
      ])
    );

    fireEvent.change(screen.getByPlaceholderText("Search sessions"), {
      target: { value: "login" },
    });

    expect(screen.getByText("Fix the login bug")).toBeInTheDocument();
    expect(screen.queryByText("Unrelated work")).toBeNull();
  });

  it("filters by status through the Status chip", () => {
    render(grid([task(), task({ id: "t2", title: "Broken run", status: "failed" })]));

    const statusChip = screen
      .getByText("Status", { selector: "summary" })
      .closest("details") as HTMLElement;
    fireEvent.click(within(statusChip).getByRole("button", { name: /^Failed/ }));

    expect(screen.getByText("Broken run")).toBeInTheDocument();
    expect(screen.queryByText("Fix the login bug")).toBeNull();
  });

  it("groups sessions by project", () => {
    render(
      grid([
        task(),
        task({
          id: "t2",
          title: "Other repo work",
          repo: repo("second-brain"),
        }),
      ])
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "project" } });

    expect(screen.getByRole("heading", { name: "vibe-code" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "second-brain" })).toBeInTheDocument();
  });

  it("stops a running session when its card is dismissed", () => {
    const onStop = vi.fn();
    render(grid([task()], onStop));

    fireEvent.click(screen.getByRole("button", { name: /Dismiss Fix the login bug/ }));

    expect(onStop).toHaveBeenCalledWith("t1");
    expect(screen.queryByText("Fix the login bug")).toBeNull();
  });
});
