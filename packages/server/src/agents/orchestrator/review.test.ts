import { describe, expect, it, mock, spyOn, afterEach } from "bun:test";
import { runReviewPipeline } from "./review";
import * as reviewerModule from "../engines/reviewer";

describe("runReviewPipeline", () => {
  afterEach(() => {
    mock.restore();
  });

  it("runs the review pipeline for all personas and extracts findings", async () => {
    // Instead of mock.module, we spy on the exported function to prevent global leaks
    const runPersonaReviewMock = spyOn(reviewerModule, "runPersonaReview").mockImplementation(async (args: any) => {
      if (args.persona === "frontend") {
        return {
          persona: "frontend",
          content: "BLOCKER: accessibility issue\nINFO: nice code",
          hasBlocker: true,
        };
      }
      if (args.persona === "backend") {
        return {
          persona: "backend",
          content: "WARNING: possible N+1 query",
          hasBlocker: false,
        };
      }
      if (args.persona === "docs") {
        return {
          persona: "docs",
          content: "WARNING: missing README update",
          hasBlocker: false,
        };
      }
      return { persona: args.persona, content: "LGTM", hasBlocker: false };
    });

    const task = { id: "t1", title: "Test", description: "Test desc" } as any;
    const run = { id: "r1" } as any;
    const db = {
      logs: {
        create: mock(),
      },
    } as any;
    const hub = {
      broadcastToTask: mock(),
    } as any;
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
    expect(runPersonaReviewMock).toHaveBeenCalledTimes(5); // For all personas
  });
});
