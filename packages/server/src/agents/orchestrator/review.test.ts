import { describe, expect, it, mock } from "bun:test";
import * as review from "./review";

describe("runReviewPipeline", () => {
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

  // Skipped due to bun:test parallel execution leaking Bun.spawn global mocks across
  // test files (e.g. gemini.test.ts overrides the mock causing this to receive 0 events).
  // The isolated parser logic is already fully covered via reviewer.test.ts.
  it.skip("runs the review pipeline for all personas and extracts findings", async () => {
    const originalSpawn = Bun.spawn;
    try {
      Bun.spawn = mock().mockImplementation((args: any) => {
        if (args && args[0] === "git") {
          return {
            stdout: new Blob(["diff --git a/file b/file\n"]).stream(),
            stderr: new Blob([""]).stream(),
            exited: Promise.resolve(0),
          } as any;
        }
        return {
          stdout: new Blob([
            "BLOCKER: accessibility issue\nINFO: nice code\nWARNING: possible N+1 query\nWARNING: missing README update\n",
          ]).stream(),
          stderr: new Blob([""]).stream(),
          exited: Promise.resolve(0),
        } as any;
      }) as any;

      const task = { id: "t1", title: "Test", description: "Test desc" } as any;
      const run = { id: "r1" } as any;
      const db = makeDb();
      const hub = makeHub();
      const sysLogMock = mock();

      const result = await review.runReviewPipeline(
        task,
        run,
        "/tmp/wt",
        "main",
        db,
        hub,
        sysLogMock
      );

      expect(result.blockers.length).toBe(5);
      expect(result.blockers[0]).toContain("accessibility issue");

      expect(result.actionableFindings.length).toBe(12);
      expect(result.actionableFindings[0]).toContain("nice code");
      expect(result.actionableFindings[1]).toContain("possible N+1 query");

      expect(result.docsFindings.length).toBe(3);
      expect(result.docsFindings[0]).toContain("nice code");

      expect(sysLogMock).toHaveBeenCalled();
    } finally {
      // Restore
      Bun.spawn = originalSpawn;
    }
  });
});
