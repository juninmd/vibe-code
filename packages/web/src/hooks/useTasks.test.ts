import { act, renderHook } from "@testing-library/react";
import type { TaskWithRun } from "@vibe-code/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTasks } from "./useTasks";

const mockTask: TaskWithRun = {
  id: "task-1",
  title: "Test task",
  description: "desc",
  repoId: "repo-1",
  status: "backlog",
  engine: "claude-code",
  model: null,
  priority: 0,
  columnOrder: 0,
  baseBranch: null,
  branchName: null,
  prUrl: null,
  parentTaskId: null,
  tags: [],
  notes: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  latestRun: undefined,
  repo: undefined,
};

vi.mock("../api/client", () => ({
  api: {
    tasks: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      archiveDone: vi.fn(),
      clearFailed: vi.fn(),
      retryFailed: vi.fn(),
      launch: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
      retryPR: vi.fn(),
      clone: vi.fn(),
    },
  },
}));

import { api } from "../api/client";

describe("useTasks", () => {
  beforeEach(() => {
    vi.mocked(api.tasks.list).mockResolvedValue([mockTask]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches tasks on mount", async () => {
    const { result } = renderHook(() => useTasks());
    expect(result.current.loading).toBe(true);
    await act(async () => {});
    expect(result.current.loading).toBe(false);
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].id).toBe("task-1");
  });

  it("filters tasks by repoId", async () => {
    renderHook(() => useTasks("repo-1"));
    await act(async () => {});
    expect(api.tasks.list).toHaveBeenCalledWith("repo-1");
  });

  it("updateTaskLocal updates a task in-place without refetching", async () => {
    const { result } = renderHook(() => useTasks());
    await act(async () => {});

    const updatedTask = { ...mockTask, title: "Updated title" };
    act(() => result.current.updateTaskLocal(updatedTask));

    expect(result.current.tasks[0].title).toBe("Updated title");
    // list should only have been called once (on mount)
    expect(api.tasks.list).toHaveBeenCalledTimes(1);
  });

  it("createTask appends the new task without refetching", async () => {
    vi.mocked(api.tasks.create).mockResolvedValue(mockTask);
    vi.mocked(api.tasks.get).mockResolvedValue(mockTask);
    const { result } = renderHook(() => useTasks());
    await act(async () => {});

    await act(async () => {
      await result.current.createTask({
        title: "New task",
        repoId: "repo-1",
      });
    });

    expect(api.tasks.create).toHaveBeenCalledOnce();
    expect(api.tasks.get).toHaveBeenCalledOnce();
    expect(api.tasks.list).toHaveBeenCalledTimes(1);
    expect(result.current.tasks[0].id).toBe("task-1");
  });
});
