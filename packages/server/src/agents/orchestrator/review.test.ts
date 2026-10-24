import { afterEach, beforeEach, describe, expect, it, spyOn, mock } from "bun:test";
import { runReviewPipeline } from "./review";

describe("runReviewPipeline", () => {
  let dbMock: any;
  let hubMock: any;
  let sysLogMock: any;
  let promiseAllSpy: any;
  let isTestingReviewPipeline = false;

  beforeEach(() => {
    dbMock = {
      logs: {
        create: mock(() => {}),
      },
    };
    hubMock = {
      broadcastToTask: mock(() => {}),
    };
    sysLogMock = mock(() => {});

    const originalPromiseAll = Promise.all.bind(Promise);
    promiseAllSpy = spyOn(Promise, "all").mockImplementation((values) => {
      if (isTestingReviewPipeline && Array.isArray(values) && values.length === 5) {
        return Promise.resolve([
          {
            persona: "frontend",
            hasBlocker: true,
            content: "BLOCKER: Frontend must not crash\nINFO: Use functional components",
          },
          {
            persona: "backend",
            hasBlocker: false,
            content: "WARNING: Unsafe DB query",
          },
          {
            persona: "docs",
            hasBlocker: false,
            content: "WARNING: Missing JSDoc",
          },
          {
            persona: "security",
            hasBlocker: false,
            content: "Looks good.",
          },
          {
            persona: "quality",
            hasBlocker: false,
            content: "INFO: Code is readable",
          }
        ]);
      }
      return originalPromiseAll(values);
    });
  });

  afterEach(() => {
    promiseAllSpy.mockRestore();
    isTestingReviewPipeline = false;
  });

  it("successfully parses blockers, actionable findings, and docs findings", async () => {
    isTestingReviewPipeline = true;
    const task = { id: "t1", title: "Test Task", description: "Desc" } as any;
    const run = { id: "r1" } as any;

    const result = await runReviewPipeline(
      task,
      run,
      "/fake/path",
      "main",
      dbMock,
      hubMock,
      sysLogMock
    );

    expect(result.blockers).toEqual([
      "[Frontend] BLOCKER: Frontend must not crash",
    ]);
    expect(result.actionableFindings).toEqual([
      "[Frontend] INFO: Use functional components",
      "[Backend] WARNING: Unsafe DB query",
      "[Quality] INFO: Code is readable"
    ]);
    expect(result.docsFindings).toEqual([
      "[Docs] WARNING: Missing JSDoc",
    ]);

    expect(sysLogMock).toHaveBeenCalledWith(
      "r1",
      "t1",
      "Starting review pipeline (5 parallel agents)..."
    );
    expect(sysLogMock).toHaveBeenCalledWith(
      "r1",
      "t1",
      "Review pipeline finished with 1 blocker(s)."
    );

    expect(dbMock.logs.create).toHaveBeenCalled();
    expect(hubMock.broadcastToTask).toHaveBeenCalled();
  });

  it("handles when there are no blockers", async () => {
    const originalPromiseAll = Promise.all.bind(Promise);
    promiseAllSpy.mockImplementation((values: any) => {
      if (isTestingReviewPipeline && Array.isArray(values) && values.length === 5) {
        return Promise.resolve([
          { persona: "frontend", hasBlocker: false, content: "All good" },
          { persona: "backend", hasBlocker: false, content: "All good" },
          { persona: "docs", hasBlocker: false, content: "All good" },
          { persona: "security", hasBlocker: false, content: "All good" },
          { persona: "quality", hasBlocker: false, content: "All good" }
        ]);
      }
      return originalPromiseAll(values);
    });

    isTestingReviewPipeline = true;
    const task = { id: "t1", title: "Test Task", description: "Desc" } as any;
    const run = { id: "r1" } as any;

    const result = await runReviewPipeline(
      task,
      run,
      "/fake/path",
      "main",
      dbMock,
      hubMock,
      sysLogMock
    );

    expect(result.blockers).toHaveLength(0);
    expect(sysLogMock).toHaveBeenCalledWith(
      "r1",
      "t1",
      "Review pipeline passed — no blockers found."
    );
  });
});
