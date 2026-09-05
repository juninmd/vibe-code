import { describe, expect, it, mock } from "bun:test";
import type { Task, TaskExecutionPlan } from "@vibe-code/shared";
import {
  buildPlanNodes,
  extractCandidateSteps,
  inferTaskType,
  materializeTaskExecutionPlan,
} from "./task-plan";

describe("task-plan tests", () => {
  describe("extractCandidateSteps", () => {
    it("extracts from bullet points", () => {
      const task = {
        description: "- Do step 1\n* Do step 2\n+ Do step 3\n1. Do step 4\n[x] Do step 5",
      } as Task;
      const steps = extractCandidateSteps(task);
      expect(steps.length).toBe(5);
      expect(steps[0]).toBe("Do step 1");
    });

    it("extracts from sentences if no bullets are present", () => {
      const task = {
        description:
          "This is a long sentence that should become a step. This is another long sentence that should become a step.",
      } as Task;
      const steps = extractCandidateSteps(task);
      expect(steps.length).toBe(2);
      expect(steps[0]).toBe("This is a long sentence that should become a step.");
    });

    it("returns default fallback steps if nothing else matches", () => {
      const task = { title: "Title", description: "Short" } as Task;
      const steps = extractCandidateSteps(task);
      expect(steps.length).toBe(3);
      expect(steps[0]).toContain("Clarify the scope");
    });
  });

  describe("inferTaskType", () => {
    it("infers frontend", () => expect(inferTaskType("update ui")).toBe("frontend"));
    it("infers test", () => expect(inferTaskType("add coverage")).toBe("test"));
    it("infers docs", () => expect(inferTaskType("update doc")).toBe("docs"));
    it("infers infra", () => expect(inferTaskType("setup infra")).toBe("infra"));
    it("infers refactor", () => expect(inferTaskType("cleanup code")).toBe("refactor"));
    it("infers bugfix", () => expect(inferTaskType("fix bug")).toBe("bugfix"));
    it("infers chore", () => expect(inferTaskType("upgrade dep")).toBe("chore"));
    it("infers backend by default", () =>
      expect(inferTaskType("add new generic logic")).toBe("backend"));
  });

  describe("buildPlanNodes", () => {
    it("handles preparation and terminal nodes correctly", () => {
      const task = { title: "T" } as Task;
      const nodes = buildPlanNodes(task, ["Analyze scope", "Implement it", "Validate changes"]);
      expect(nodes.length).toBe(3);
      expect(nodes[0].dependsOn).toEqual([]);
      expect(nodes[1].dependsOn).toEqual(["node-1"]); // implementation depends on analysis
      expect(nodes[2].dependsOn).toEqual(["node-2"]); // validation depends on implementation
    });

    it("handles multiple sequential preparation and execution nodes", () => {
      const task = { title: "T" } as Task;
      const nodes = buildPlanNodes(task, ["Analyze it", "Analyze more", "Do A", "Do B", "Verify"]);
      expect(nodes[0].dependsOn).toEqual([]);
      expect(nodes[1].dependsOn).toEqual(["node-1"]);
      expect(nodes[2].dependsOn).toEqual(["node-2"]);
      expect(nodes[3].dependsOn).toEqual(["node-2"]); // Do B depends on the last prep node
      expect(nodes[4].dependsOn).toEqual(["node-2"]); // Verification terminal node gets exactly what the implementation computes
    });
  });

  describe("materializeTaskExecutionPlan", () => {
    it("returns existing children if force is false", () => {
      const mockDb = {
        tasks: { listChildren: mock().mockReturnValue([{ id: "child-1" }]) },
        artifacts: { upsert: mock() },
      };
      const plan = { nodes: [] } as any;
      const res = materializeTaskExecutionPlan(mockDb as any, { id: "p1" } as Task, plan);
      expect(res.reusedTasks.length).toBe(1);
    });

    it("creates tasks correctly when distributing budget", () => {
      let createdCount = 0;
      let updatedCount = 0;
      const mockDb = {
        tasks: {
          listChildren: mock().mockReturnValue([]),
          create: mock().mockImplementation((d) => {
            createdCount++;
            return { id: `task-${createdCount}`, ...d };
          }),
          update: mock().mockImplementation((id, data) => {
            updatedCount++;
            return { id, ...data };
          }),
        },
        artifacts: { upsert: mock() },
      };
      const parentTask = { id: "p1", maxCost: 10 } as Task;
      const plan = {
        nodes: [
          {
            id: "n1",
            title: "n1",
            description: "d1",
            dependsOn: [],
            tags: [],
            acceptanceCriteria: [],
          },
          {
            id: "n2",
            title: "n2",
            description: "d2",
            dependsOn: ["n1"],
            tags: [],
            acceptanceCriteria: [],
          },
        ],
      } as unknown as TaskExecutionPlan;

      const res = materializeTaskExecutionPlan(mockDb as any, parentTask, plan);
      expect(res.createdTasks.length).toBe(2);
      expect(createdCount).toBe(2);
      // Nodes update happens because dependsOn mapping resolves (n1 -> task-1, so node n2 depends on task-1)
      // Also update happens because budget is set.
      // All nodes actually get an update because distributeBudget sets maxCost for each node.
      expect(updatedCount).toBe(2);
    });
  });
});
