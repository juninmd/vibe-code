import { expect, test, describe, mock, spyOn } from "bun:test";
import { retryPR } from "./pr-retry";

describe("retryPR", () => {
  const mockTask = {
    id: "task-1",
    status: "review",
    branchName: "feature-branch",
    repoId: "repo-1",
    baseBranch: "main",
    description: "Task description",
    title: "Task title",
  };

  const mockRepo = {
    id: "repo-1",
    name: "test-repo",
    defaultBranch: "main",
    localPath: "/path/to/repo",
    url: "https://github.com/test/repo",
  };

  const mockRun = {
    id: "run-1",
    engine: "opencode",
  };

  const mockEngine = {
    name: "opencode",
  };

  const createMockDb = () => ({
    tasks: {
      getById: mock().mockImplementation((id) => (id === "task-1" ? mockTask : undefined)),
      updateField: mock(),
    },
    repos: {
      getById: mock().mockImplementation((id) => (id === "repo-1" ? mockRepo : undefined)),
    },
    runs: {
      getLatestByTask: mock().mockImplementation((id) => (id === "task-1" ? mockRun : undefined)),
    },
    logs: {
      create: mock(),
    },
  });

  const createMockGit = () => ({
    getBarePath: mock().mockReturnValue("/bare/path"),
    createWorktree: mock().mockResolvedValue("/path/to/wt"),
    push: mock().mockResolvedValue(undefined),
    createPR: mock().mockResolvedValue("https://github.com/test/repo/pull/1"),
    removeWorktree: mock().mockResolvedValue(undefined),
  });

  const createMockRegistry = () => ({
    get: mock().mockImplementation((name) => (name === "opencode" ? mockEngine : undefined)),
  });

  const createMockHub = () => ({
    broadcastToTask: mock(),
    broadcastAll: mock(),
  });

  test("throws if task not found", async () => {
    const db = createMockDb();
    db.tasks.getById.mockReturnValue(undefined);

    await expect(
      retryPR("task-1", db as any, createMockGit() as any, createMockRegistry() as any, createMockHub() as any)
    ).rejects.toThrow("Task not found");
  });

  test("throws if task not in review status", async () => {
    const db = createMockDb();
    db.tasks.getById.mockReturnValue({ ...mockTask, status: "completed" });

    await expect(
      retryPR("task-1", db as any, createMockGit() as any, createMockRegistry() as any, createMockHub() as any)
    ).rejects.toThrow("Task must be in review status");
  });

  test("throws if task has no branch associated", async () => {
    const db = createMockDb();
    db.tasks.getById.mockReturnValue({ ...mockTask, branchName: undefined });

    await expect(
      retryPR("task-1", db as any, createMockGit() as any, createMockRegistry() as any, createMockHub() as any)
    ).rejects.toThrow("Task has no branch associated");
  });

  test("throws if repository not found", async () => {
    const db = createMockDb();
    db.repos.getById.mockReturnValue(undefined);

    await expect(
      retryPR("task-1", db as any, createMockGit() as any, createMockRegistry() as any, createMockHub() as any)
    ).rejects.toThrow("Repository not found");
  });

  test("throws if no run found for this task", async () => {
    const db = createMockDb();
    db.runs.getLatestByTask.mockReturnValue(undefined);

    await expect(
      retryPR("task-1", db as any, createMockGit() as any, createMockRegistry() as any, createMockHub() as any)
    ).rejects.toThrow("No run found for this task");
  });

  test("throws if engine not found", async () => {
    const registry = createMockRegistry();
    registry.get.mockReturnValue(undefined);

    await expect(
      retryPR("task-1", createMockDb() as any, createMockGit() as any, registry as any, createMockHub() as any)
    ).rejects.toThrow("Engine opencode not found");
  });

  test("successfully retries PR, updates db and broadcasts", async () => {
    const db = createMockDb();
    const git = createMockGit();
    const registry = createMockRegistry();
    const hub = createMockHub();

    const prUrl = await retryPR("task-1", db as any, git as any, registry as any, hub as any);

    expect(prUrl).toBe("https://github.com/test/repo/pull/1");

    expect(git.createWorktree).toHaveBeenCalledWith(
      "/path/to/repo",
      "feature-branch",
      "test-repo",
      expect.any(String),
      "main",
      false
    );
    expect(git.push).toHaveBeenCalledWith("/path/to/wt", "feature-branch");
    expect(git.createPR).toHaveBeenCalledWith(
      "/path/to/wt",
      "https://github.com/test/repo",
      "feature-branch",
      "Task title",
      "Task description\n\n---\n_Created by vibe-code agent using opencode_",
      "main"
    );

    expect(db.tasks.updateField).toHaveBeenCalledWith("task-1", "pr_url", "https://github.com/test/repo/pull/1");
    expect(hub.broadcastAll).toHaveBeenCalledWith({ type: "task_updated", task: mockTask });
    expect(git.removeWorktree).toHaveBeenCalledWith("/path/to/repo", "/path/to/wt");

    // Check logging
    expect(db.logs.create).toHaveBeenCalled();
    expect(hub.broadcastToTask).toHaveBeenCalled();
  });

  test("uses defaultBranch if task baseBranch is missing", async () => {
    const db = createMockDb();
    db.tasks.getById.mockReturnValue({ ...mockTask, baseBranch: undefined });
    const git = createMockGit();

    await retryPR("task-1", db as any, git as any, createMockRegistry() as any, createMockHub() as any);

    expect(git.createWorktree).toHaveBeenCalledWith(
      "/path/to/repo",
      "feature-branch",
      "test-repo",
      expect.any(String),
      "main", // defaultBranch
      false
    );
  });

  test("uses barePath from git if localPath is missing", async () => {
    const db = createMockDb();
    db.repos.getById.mockReturnValue({ ...mockRepo, localPath: undefined });
    const git = createMockGit();

    await retryPR("task-1", db as any, git as any, createMockRegistry() as any, createMockHub() as any);

    expect(git.createWorktree).toHaveBeenCalledWith(
      "/bare/path",
      "feature-branch",
      "test-repo",
      expect.any(String),
      "main",
      false
    );
  });

  test("throws error if git operations fail, but still tries to clean up", async () => {
    const db = createMockDb();
    const git = createMockGit();
    git.push.mockRejectedValue(new Error("Push failed"));
    const hub = createMockHub();

    await expect(
      retryPR("task-1", db as any, git as any, createMockRegistry() as any, hub as any)
    ).rejects.toThrow("Push failed");

    expect(git.removeWorktree).toHaveBeenCalledWith("/path/to/repo", "/path/to/wt");
    expect(db.logs.create).toHaveBeenCalledWith("run-1", "system", "PR retry failed: Push failed");
  });

  test("ignores error if cleanup fails", async () => {
    const git = createMockGit();
    git.removeWorktree.mockRejectedValue(new Error("Cleanup failed"));

    const prUrl = await retryPR("task-1", createMockDb() as any, git as any, createMockRegistry() as any, createMockHub() as any);

    expect(prUrl).toBe("https://github.com/test/repo/pull/1");
  });
});
