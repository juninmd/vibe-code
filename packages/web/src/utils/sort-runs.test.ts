import { describe, expect, it } from "vitest";
import { partitionRuns, sortPastRuns } from "./sort-runs";

const r = (id: string, status: string, finishedAt = "2026-05-19T00:00:00Z") => ({
  id,
  status,
  finishedAt,
});

describe("partitionRuns", () => {
  it("splits active vs terminal", () => {
    const { active, past } = partitionRuns([
      r("a", "running"),
      r("b", "queued"),
      r("c", "completed"),
      r("d", "failed"),
      r("e", "cancelled"),
    ]);
    expect(active.map((x) => x.id)).toEqual(["a", "b"]);
    expect(past.map((x) => x.id).sort()).toEqual(["c", "d", "e"]);
  });

  it("ignores unknown statuses", () => {
    const { active, past } = partitionRuns([r("x", "weird-state")]);
    expect(active.length).toBe(0);
    expect(past.length).toBe(0);
  });
});

describe("sortPastRuns", () => {
  it("orders failed → cancelled → completed", () => {
    const out = sortPastRuns([
      r("c1", "completed", "2026-05-19T10:00:00Z"),
      r("f1", "failed", "2026-05-19T01:00:00Z"),
      r("x1", "cancelled", "2026-05-19T05:00:00Z"),
    ]);
    expect(out.map((x) => x.id)).toEqual(["f1", "x1", "c1"]);
  });

  it("within group, newest finishedAt first", () => {
    const out = sortPastRuns([
      r("f-old", "failed", "2026-05-19T01:00:00Z"),
      r("f-new", "failed", "2026-05-19T03:00:00Z"),
      r("f-mid", "failed", "2026-05-19T02:00:00Z"),
    ]);
    expect(out.map((x) => x.id)).toEqual(["f-new", "f-mid", "f-old"]);
  });

  it("treats done as completed for ranking", () => {
    const out = sortPastRuns([
      r("c", "completed", "2026-05-19T02:00:00Z"),
      r("d", "done", "2026-05-19T03:00:00Z"),
      r("f", "failed", "2026-05-19T01:00:00Z"),
    ]);
    expect(out[0].id).toBe("f");
    // d > c by time → d before c in their group
    expect(out.map((x) => x.id)).toEqual(["f", "d", "c"]);
  });

  it("falls back to startedAt / createdAt when finishedAt missing", () => {
    const out = sortPastRuns([
      { status: "failed", id: "a", createdAt: "2026-05-19T01:00:00Z" },
      { status: "failed", id: "b", startedAt: "2026-05-19T05:00:00Z" },
    ] as { status: string; id: string; createdAt?: string; startedAt?: string }[]);
    expect((out[0] as { id: string }).id).toBe("b");
  });
});
