import { describe, expect, it } from "bun:test";
import { ApprovalBroker, type ApprovalNotice, approvalLogLine } from "./approvals";

const ask = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  permission: "edit",
  patterns: ["src/a.ts"],
  metadata: { diff: "@@ -1 +1 @@\n-a\n+b" },
  ...extra,
});

describe("ApprovalBroker", () => {
  it("holds the call until the operator answers, then notifies both ends", async () => {
    const notices: ApprovalNotice[] = [];
    const broker = new ApprovalBroker((n) => notices.push(n));
    const reply = broker.request("t1", "r1", ask("per_1"));
    expect(broker.listByTask("t1")).toHaveLength(1);
    expect(broker.hasPending("r1")).toBe(true);
    expect(notices[0]).toMatchObject({
      kind: "requested",
      approval: { id: "per_1", diff: "@@ -1 +1 @@\n-a\n+b" },
    });

    expect(broker.resolve("t1", "per_1", "always")).toBe(true);
    expect(await reply).toBe("always");
    expect(broker.hasPending("r1")).toBe(false);
    expect(notices[1]).toMatchObject({ kind: "resolved", reply: "always" });
  });

  it("refuses answers for another task or a request already answered", () => {
    const broker = new ApprovalBroker(() => {});
    void broker.request("t1", "r1", ask("per_1"));
    expect(broker.resolve("t2", "per_1", "once")).toBe(false);
    expect(broker.resolve("t1", "per_1", "once")).toBe(true);
    expect(broker.resolve("t1", "per_1", "once")).toBe(false);
  });

  it("rejects what a stopped run was waiting on, without touching other runs", async () => {
    const broker = new ApprovalBroker(() => {});
    const stopped = broker.request("t1", "r1", ask("per_1"));
    void broker.request("t2", "r2", ask("per_2"));
    broker.cancelRun("r1");
    expect(await stopped).toBe("reject");
    expect(broker.listByTask("t2")).toHaveLength(1);
  });

  it("shows the repo path instead of the server's worktree path", () => {
    const notices: ApprovalNotice[] = [];
    const broker = new ApprovalBroker((n) => notices.push(n));
    void broker.request(
      "t1",
      "r1",
      ask("per_1", {
        patterns: ["src/a.ts"],
        metadata: {
          filepath: "/srv/ws/x/src/a.ts",
          diff: "--- /srv/ws/x/src/a.ts\n+++ /srv/ws/x/src/a.ts",
        },
      })
    );
    expect(notices[0].approval.diff).toBe("--- src/a.ts\n+++ src/a.ts");
  });

  it("bounds what reaches the browser", () => {
    const notices: ApprovalNotice[] = [];
    const broker = new ApprovalBroker((n) => notices.push(n));
    void broker.request(
      "t1",
      "r1",
      ask("per_1", {
        patterns: Array.from({ length: 50 }, (_, i) => `f${i}`),
        metadata: { diff: "x".repeat(20_000) },
      })
    );
    const { approval } = notices[0];
    expect(approval.patterns).toHaveLength(20);
    expect(approval.diff).toHaveLength(8_000);
  });
});

describe("approvalLogLine", () => {
  it("records the ask and the answer in the history", () => {
    const approval = {
      id: "p",
      taskId: "t",
      runId: "r",
      permission: "bash",
      patterns: ["bun test"],
      createdAt: "",
    };
    expect(approvalLogLine({ kind: "requested", approval })).toBe("[approval] bash: bun test");
    expect(approvalLogLine({ kind: "resolved", approval, reply: "reject" })).toBe(
      "[approval] bash: bun test — recusado"
    );
  });
});
