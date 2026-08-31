import { describe, expect, it, mock } from "bun:test";

mock.module("../engines/reviewer", () => ({
  runPersonaReview: mock().mockImplementation(async ({ persona }) => {
    if (persona === "frontend") {
      return {
        persona,
        content: "BLOCKER: accessibility issue\nINFO: nice code",
        hasBlocker: true,
      };
    }
    if (persona === "backend") {
      return {
        persona,
        content: "WARNING: possible N+1 query",
        hasBlocker: false,
      };
    }
    if (persona === "docs") {
      return {
        persona,
        content: "WARNING: missing README update",
        hasBlocker: false,
      };
    }
    return { persona, content: "LGTM", hasBlocker: false };
  }),
  PERSONA_LABELS: {
    frontend: "Frontend",
    backend: "Backend",
    security: "Security",
    quality: "Quality",
    docs: "Docs",
  },
}));

import { runReviewPipeline } from "./review";

function makeDb() {
  return {
    logs: {
      create: mock(),
    },
  } as any;
}

function makeHub() {
  return {
    broadcastToTask: mock(),
  } as any;
}

describe.skip("runReviewPipeline", () => {
  it("runs the review pipeline for all personas and extracts findings", async () => {
    const task = { id: "t1", title: "Test", description: "Test desc" } as any;
    const run = { id: "r1" } as any;
    const db = makeDb();
    const hub = makeHub();
    const sysLogMock = mock();

    const result = await runReviewPipeline(task, run, "/tmp/wt", "main", db, hub, sysLogMock);

    expect(result.blockers.length).toBe(1);
    expect(result.blockers[0]).toContain("accessibility issue");

    expect(result.actionableFindings.length).toBe(2);
    expect(result.actionableFindings[0]).toContain("nice code");
    expect(result.actionableFindings[1]).toContain("possible N+1 query");

    expect(result.docsFindings.length).toBe(1);
    expect(result.docsFindings[0]).toContain("missing README update");

    expect(sysLogMock).toHaveBeenCalled();
  });
});
