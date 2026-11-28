import { describe, expect, it, mock } from "bun:test";
import type { Task } from "@vibe-code/shared";
import { appendRuntimeContextHints, buildContextAsync, buildPrompt } from "./prompt";

describe("prompt tests", () => {
  describe("buildPrompt", () => {
    it("builds prompt with task title and description", () => {
      const task = { title: "Title", description: "Desc" } as Task;
      const prompt = buildPrompt(task);
      expect(prompt).toContain("Task: Title");
      expect(prompt).toContain("Desc");
      expect(prompt).toContain("fully automated, non-interactive");
    });

    it("builds prompt with task goal and desired outcome", () => {
      const task = { title: "T", goal: "G", desiredOutcome: "O" } as Task;
      const prompt = buildPrompt(task);
      expect(prompt).toContain("**Goal:** G");
      expect(prompt).toContain("**Desired outcome:** O");
    });

    it("builds prompt with memory context", () => {
      const task = { title: "T" } as Task;
      const prompt = buildPrompt(task, "Shared memory text", "Task memory text");
      expect(prompt).toContain("Shared Context");
      expect(prompt).toContain("Shared memory text");
      expect(prompt).toContain("Task-Specific Context");
      expect(prompt).toContain("Task memory text");
    });
  });

  describe("appendRuntimeContextHints", () => {
    it("appends hints without planner spec", () => {
      const res = appendRuntimeContextHints("hello");
      expect(res).toContain("hello");
      expect(res).toContain("PROGRESS.md");
      expect(res).not.toContain("SPEC.md");
    });

    it("appends hints with planner spec", () => {
      const res = appendRuntimeContextHints("hello", { hasPlannerSpec: true });
      expect(res).toContain("hello");
      expect(res).toContain("PROGRESS.md");
      expect(res).toContain("SPEC.md");
    });
  });

  describe("buildContextAsync", () => {
    it("handles full context loading", async () => {
      const task = { title: "T", repoId: "R1", parentTaskId: "P1" } as Task;

      const mockSkillsLoader = {
        load: mock().mockResolvedValue({
          skills: [{ name: "s1", description: "d1", filePath: "s1.md" }],
          rules: [{ name: "r1", description: "r1", filePath: "r1.md" }],
          agents: [{ name: "a1", description: "a1", filePath: "a1.md" }],
          workflows: [{ name: "w1", description: "w1", filePath: "w1.md" }],
        }),
        getFileContent: mock().mockResolvedValue("content"),
      };

      const mockFindingsLoader = mock().mockReturnValue([
        { persona: "test", severity: "high", content: "f1" },
      ]);
      const mockParentTaskLoader = mock().mockResolvedValue({
        id: "P1",
        title: "P1",
        description: "P1",
      });
      const mockMemoryLoader = mock().mockResolvedValue({
        sharedMemory: "sm",
        taskMemory: "tm",
        entries: [],
      });
      const mockDbMetricsLoader = mock().mockReturnValue([]);

      const result = await buildContextAsync(
        task,
        "/tmp",
        mockSkillsLoader as any,
        "R1",
        mockFindingsLoader,
        mockParentTaskLoader,
        mockMemoryLoader,
        mockDbMetricsLoader
      );

      expect(result.prompt).toContain("T");
      expect(result.prompt).toContain("f1"); // finding
      expect(result.prompt).toContain("P1"); // parent task
      expect(result.prompt).toContain("sm"); // memory
    });
  });
});
