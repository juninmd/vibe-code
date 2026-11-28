import { describe, expect, it } from "bun:test";
import { SHARED_OWNER, taskOwner } from "./owner";

const db = {
  runs: { getById: (id: string) => (id === "run-1" ? { taskId: "t1" } : null) },
  tasks: { getById: (id: string) => (id === "t1" ? { repoId: "r1" } : null) },
  repos: {
    getById: (id: string) => (id === "r1" ? { workspaceId: "ws-ana" } : { workspaceId: undefined }),
  },
};

describe("taskOwner", () => {
  it("maps a worktree to the workspace of its repository", () => {
    expect(taskOwner(db, "/data/workspaces/app/run-1")).toBe("ws-ana");
  });

  it("puts unknown runs in the shared owner instead of failing the turn", () => {
    expect(taskOwner(db, "/data/workspaces/app/run-404")).toBe(SHARED_OWNER);
  });
});
