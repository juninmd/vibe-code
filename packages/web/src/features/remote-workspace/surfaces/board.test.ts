import type { TaskStatus, TaskWithRun } from "@vibe-code/shared";
import { describe, expect, it } from "vitest";
import { groupByLane, planMove } from "./board";

const task = (id: string, status: TaskStatus, columnOrder = 0) =>
  ({ id, status, columnOrder }) as TaskWithRun;

describe("groupByLane", () => {
  it("orders each lane by column order and drops archived tasks", () => {
    const lanes = groupByLane([
      task("b", "backlog", 2),
      task("a", "backlog", 1),
      task("x", "archived"),
    ]);
    expect(lanes.backlog.map((t) => t.id)).toEqual(["a", "b"]);
    expect(Object.values(lanes).flat()).toHaveLength(2);
  });
});

describe("planMove", () => {
  const lanes = groupByLane([task("a", "backlog"), task("r", "review", 4)]);

  it("ignores a drop on the lane the task is already in", () => {
    expect(planMove(lanes.backlog[0], "backlog", lanes)).toBeNull();
  });

  it("starts the agent instead of faking the running status", () => {
    expect(planMove(lanes.backlog[0], "in_progress", lanes)).toEqual({ kind: "launch" });
  });

  it("appends to the end of the target lane", () => {
    expect(planMove(lanes.backlog[0], "review", lanes)).toEqual({
      kind: "update",
      status: "review",
      columnOrder: 5,
    });
    expect(planMove(lanes.review[0], "done", lanes)).toEqual({
      kind: "update",
      status: "done",
      columnOrder: 0,
    });
  });
});
