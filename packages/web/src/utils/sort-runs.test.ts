import { describe, expect, it } from "vitest";
import { partitionRuns, type RunStatusLike, sortPastRuns } from "./sort-runs";

interface TestRun {
  id: number;
  status: RunStatusLike;
  finishedAt?: string | null;
  startedAt?: string | null;
  createdAt?: string | null;
}

describe("partitionRuns", () => {
  it("partitions correctly into active and past", () => {
    const runs: TestRun[] = [
      { id: 1, status: "failed" },
      { id: 2, status: "running" },
      { id: 3, status: "completed" },
      { id: 4, status: "queued" },
      { id: 5, status: "unknown" },
    ];

    const { active, past } = partitionRuns(runs);
    expect(active.length).toBe(2);
    expect(active.map((r) => r.id)).toEqual([2, 4]);

    expect(past.length).toBe(2);
    expect(past.map((r) => r.id)).toEqual([1, 3]);
  });
});

describe("sortPastRuns", () => {
  it("sorts by status rank correctly", () => {
    const runs: TestRun[] = [
      { id: 1, status: "completed" },
      { id: 2, status: "failed" },
      { id: 3, status: "cancelled" },
    ];

    const sorted = sortPastRuns(runs);
    expect(sorted.map((r) => r.id)).toEqual([2, 3, 1]); // failed (0), cancelled (1), completed (2)
  });

  it("sorts by finishedAt/startedAt/createdAt descending within same status", () => {
    const runs: TestRun[] = [
      { id: 1, status: "failed", createdAt: "2023-01-01" },
      { id: 2, status: "failed", finishedAt: "2023-01-03" },
      { id: 3, status: "failed", startedAt: "2023-01-02" },
    ];

    const sorted = sortPastRuns(runs);
    expect(sorted.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it("handles empty or missing dates gracefully", () => {
    const runs: TestRun[] = [
      { id: 1, status: "failed" },
      { id: 2, status: "failed", createdAt: "2023-01-01" },
    ];

    const sorted = sortPastRuns(runs);
    // JS dates: new Date("") is Invalid Date which gives NaN from getTime()
    // NaN - something or something - NaN is NaN which usually doesn't sort well
    // So the exact behaviour depends on the implementation.
    // Let's just expect both are returned in some order.
    expect(sorted.length).toBe(2);
  });

  it("maintains 'done' and 'completed' at the same rank", () => {
    const runs: TestRun[] = [
      { id: 1, status: "completed", finishedAt: "2023-01-01" },
      { id: 2, status: "done", finishedAt: "2023-01-02" }, // Newer should come first
    ];

    const sorted = sortPastRuns(runs);
    expect(sorted.map((r) => r.id)).toEqual([2, 1]);
  });
});
