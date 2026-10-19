import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as reviewer from "../engines/reviewer";
import { REVIEW_ENABLED, REVIEW_STRICT, runReviewPipeline } from "./review";

describe("runReviewPipeline", () => {
  afterEach(() => {
    mock.restore();
  });

  it("has the correctly exported constants", () => {
    expect(typeof REVIEW_ENABLED).toBe("boolean");
    expect(typeof REVIEW_STRICT).toBe("boolean");
  });

  it("processes successful reviews without blockers", async () => {
    const runSpy = spyOn(reviewer, "runPersonaReview").mockImplementation(async ({ persona }) => {
      return {
        persona,
        hasBlocker: false,
        content: `Looks good!\nINFO: Minor finding for ${persona}\nWARNING: General warning`,
      };
    });

    const sysLog = mock();
    const db = { logs: { create: mock() } };
    const hub = { broadcastToTask: mock() };

    const res = await runReviewPipeline(
      { id: "task1", title: "Test", description: "desc" } as any,
      { id: "run1" } as any,
      "/wt",
      "main",
      db as any,
      hub as any,
      sysLog
    );

    expect(runSpy).toHaveBeenCalledTimes(5);
    expect(res.blockers).toHaveLength(0);
    // 4 other personas * 2 findings each = 8
    expect(res.actionableFindings).toHaveLength(8);
    // docs persona * 2 findings each = 2
    expect(res.docsFindings).toHaveLength(2);

    expect(sysLog).toHaveBeenCalledWith(
      "run1",
      "task1",
      "Review pipeline passed — no blockers found."
    );
  });

  it("processes reviews with blockers", async () => {
    const _runSpy = spyOn(reviewer, "runPersonaReview").mockImplementation(async ({ persona }) => {
      if (persona === "security") {
        return {
          persona,
          hasBlocker: true,
          content: "BLOCKER: SQL Injection detected",
        };
      }
      return {
        persona,
        hasBlocker: false,
        content: "Looks good!",
      };
    });

    const sysLog = mock();
    const db = { logs: { create: mock() } };
    const hub = { broadcastToTask: mock() };

    const res = await runReviewPipeline(
      { id: "task1", title: "Test", description: "desc" } as any,
      { id: "run1" } as any,
      "/wt",
      "main",
      db as any,
      hub as any,
      sysLog
    );

    expect(res.blockers).toHaveLength(1);
    expect(res.blockers[0]).toContain("[Security]");
    expect(res.blockers[0]).toContain("BLOCKER: SQL Injection detected");

    expect(sysLog).toHaveBeenCalledWith(
      "run1",
      "task1",
      "Review pipeline finished with 1 blocker(s)."
    );
  });

  it("filters out reviewer and stderr lines", async () => {
    const _runSpy = spyOn(reviewer, "runPersonaReview").mockImplementation(async ({ persona }) => {
      return {
        persona,
        hasBlocker: false,
        content:
          "WARNING: valid warning\nWARNING: [reviewer: something]\nINFO: valid info\nINFO: something :stderr",
      };
    });

    const sysLog = mock();
    const db = { logs: { create: mock() } };
    const hub = { broadcastToTask: mock() };

    const res = await runReviewPipeline(
      { id: "task1", title: "Test", description: "desc" } as any,
      { id: "run1" } as any,
      "/wt",
      "main",
      db as any,
      hub as any,
      sysLog
    );

    // 4 personas (excluding docs) * 2 valid findings = 8
    expect(res.actionableFindings).toHaveLength(8);
    expect(res.actionableFindings.some((f) => f.includes("[reviewer:"))).toBeFalse();
    expect(res.actionableFindings.some((f) => f.includes(":stderr"))).toBeFalse();
  });
});
