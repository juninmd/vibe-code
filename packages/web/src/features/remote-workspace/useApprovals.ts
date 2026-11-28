import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { ApprovalReply, ToolApproval } from "@vibe-code/shared";
import { useState } from "react";
import { api } from "../../api/client";
import type { Session } from "./model";

const NONE: ToolApproval[] = [];

/** Polls the pending tool calls of supervised sessions that are running (at most a few). */
export function useApprovals(sessions: Session[], enabled: boolean) {
  const client = useQueryClient();
  const watched = sessions.filter((s) => s.supervised && s.status === "working");
  const results = useQueries({
    queries: watched.map((session) => ({
      queryKey: ["tool-approvals", session.id],
      queryFn: () => api.tasks.approvals(session.id),
      enabled,
      refetchInterval: 1_500,
      retry: false,
    })),
  });
  const byTask = new Map<string, ToolApproval[]>();
  watched.forEach((session, index) => {
    const pending = results[index]?.data;
    if (pending?.length) byTask.set(session.id, pending);
  });
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (approval: ToolApproval, reply: ApprovalReply) => {
    setAnswering(approval.id);
    setError(null);
    try {
      await api.tasks.answerApproval(approval.taskId, approval.id, reply);
    } catch (cause) {
      // A 404 means the turn already moved on; the refetch below clears the card.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAnswering(null);
      await client.invalidateQueries({ queryKey: ["tool-approvals", approval.taskId] });
    }
  };

  return {
    of: (taskId: string | undefined) => (taskId ? (byTask.get(taskId) ?? NONE) : NONE),
    awaiting: new Set(byTask.keys()) as ReadonlySet<string>,
    answer,
    answering,
    error,
  };
}
