import { describe, expect, test, mock, afterEach } from "bun:test";
import { join } from "node:path";

mock.module("node:fs/promises", () => ({
  readFile: mock(async (path: string, options: any) => {
    if (path.includes("task-1")) {
      return "Docs Content with ![img](./docs/assets/pic.png)";
    }
    if (path.includes("task-2")) {
      return "a".repeat(12005);
    }
    if (path.includes("task-3")) {
      return "   ";
    }
    throw new Error("File not found");
  }),
}));

import { buildPRBody } from "./executor";

describe("executor - buildPRBody", () => {
  afterEach(() => {
    mock.restore();
  });

  test("uses docs-generated content and rewrites links", async () => {
    const task = { id: "1", title: "Task 1", description: "Desc 1" } as any;
    const result = await buildPRBody(task, "/tmp", "https://github.com/user/repo", "main");
    expect(result).toContain("https://github.com/user/repo/blob/main/docs/assets/pic.png");
  });

  test("truncates long docs content", async () => {
    const task = { id: "2", title: "Task 2", description: "Desc 2" } as any;
    const result = await buildPRBody(task, "/tmp", "https://github.com/user/repo", "main");
    expect(result).toContain("...[truncated]");
    expect(result.length).toBeLessThan(12100);
  });

  test("falls back to task description if docs is empty", async () => {
    const task = { id: "3", title: "Task 3", description: "Desc 3" } as any;
    const result = await buildPRBody(task, "/tmp", "https://github.com/user/repo", "main");
    expect(result).toBe("Desc 3");
  });

  test("falls back to task description if docs file does not exist", async () => {
    const task = { id: "4", title: "Task 4", description: "Desc 4" } as any;
    const result = await buildPRBody(task, "/tmp", "https://github.com/user/repo", "main");
    expect(result).toBe("Desc 4");
  });

  test("falls back to task title if description is missing and docs file does not exist", async () => {
    const task = { id: "5", title: "Task 5" } as any;
    const result = await buildPRBody(task, "/tmp", "https://github.com/user/repo", "main");
    expect(result).toBe("Task: Task 5");
  });
});
