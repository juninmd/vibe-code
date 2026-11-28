import type { ApprovalReply, ToolApproval } from "@vibe-code/shared";

export interface ApprovalAsk {
  id: string;
  permission: string;
  patterns: string[];
  metadata?: Record<string, unknown>;
}

export type ApprovalNotice =
  | { kind: "requested"; approval: ToolApproval }
  | { kind: "resolved"; approval: ToolApproval; reply: ApprovalReply };

const DIFF_LIMIT = 8_000;

/** OpenCode diffs name the absolute worktree path; show the operator the repo path instead. */
function relativeDiff(ask: ApprovalAsk): string | undefined {
  const diff = ask.metadata?.diff;
  if (typeof diff !== "string") return undefined;
  const absolute = ask.metadata?.filepath;
  const [relative] = ask.patterns;
  if (typeof absolute !== "string" || !absolute || !relative) return diff;
  return diff.replaceAll(absolute, relative);
}

/** Holds tool calls waiting for the operator; one entry per OpenCode permission request. */
export class ApprovalBroker {
  private pending = new Map<
    string,
    { approval: ToolApproval; resolve: (reply: ApprovalReply) => void }
  >();

  constructor(private readonly notify: (notice: ApprovalNotice) => void) {}

  request(taskId: string, runId: string, ask: ApprovalAsk): Promise<ApprovalReply> {
    const diff = relativeDiff(ask);
    const approval: ToolApproval = {
      id: ask.id,
      taskId,
      runId,
      permission: ask.permission,
      patterns: ask.patterns.slice(0, 20),
      ...(diff ? { diff: diff.slice(0, DIFF_LIMIT) } : {}),
      createdAt: new Date().toISOString(),
    };
    return new Promise((resolve) => {
      this.pending.set(ask.id, { approval, resolve });
      this.notify({ kind: "requested", approval });
    });
  }

  /** Returns false when the request is unknown, already answered, or belongs to another task. */
  resolve(taskId: string, approvalId: string, reply: ApprovalReply): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry || entry.approval.taskId !== taskId) return false;
    this.pending.delete(approvalId);
    entry.resolve(reply);
    this.notify({ kind: "resolved", approval: entry.approval, reply });
    return true;
  }

  listByTask(taskId: string): ToolApproval[] {
    return [...this.pending.values()]
      .map((entry) => entry.approval)
      .filter((approval) => approval.taskId === taskId);
  }

  hasPending(runId: string): boolean {
    for (const entry of this.pending.values()) if (entry.approval.runId === runId) return true;
    return false;
  }

  /** A stopped or finished run rejects whatever it was still waiting on. */
  cancelRun(runId: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.approval.runId !== runId) continue;
      this.pending.delete(id);
      entry.resolve("reject");
      this.notify({ kind: "resolved", approval: entry.approval, reply: "reject" });
    }
  }
}

const REPLY_LABEL: Record<ApprovalReply, string> = {
  once: "permitido uma vez",
  always: "sempre permitido nesta sessão",
  reject: "recusado",
};

/** The line kept in the conversation history, so a reload still shows what was asked. */
export function approvalLogLine(notice: ApprovalNotice): string {
  const { approval } = notice;
  const target = approval.patterns.join(", ") || "—";
  return notice.kind === "requested"
    ? `[approval] ${approval.permission}: ${target}`
    : `[approval] ${approval.permission}: ${target} — ${REPLY_LABEL[notice.reply]}`;
}
