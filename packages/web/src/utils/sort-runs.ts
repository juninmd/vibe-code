// Ported from multica packages/views/issues/components/execution-log-section.tsx.
// Past-runs ordering: failed first (needs attention), then cancelled
// (procedural noise), then completed (boring 'done' sinks to bottom).
// Within each group: newest first by (finishedAt ?? createdAt).

export type RunStatusLike =
  | "failed"
  | "cancelled"
  | "completed"
  | "done"
  | "running"
  | "queued"
  | "pending"
  | (string & {});

interface SortableRun {
  status: RunStatusLike;
  finishedAt?: string | null;
  startedAt?: string | null;
  createdAt?: string | null;
}

const PAST_STATUS_RANK: Record<string, number> = {
  failed: 0,
  cancelled: 1,
  completed: 2,
  done: 2,
};

const TERMINAL = new Set(["failed", "cancelled", "completed", "done"]);
const ACTIVE = new Set(["running", "queued", "pending", "dispatched", "in_progress"]);

export function partitionRuns<T extends SortableRun>(runs: T[]): { active: T[]; past: T[] } {
  const active: T[] = [];
  const past: T[] = [];
  for (const r of runs) {
    if (ACTIVE.has(r.status)) active.push(r);
    else if (TERMINAL.has(r.status)) past.push(r);
  }
  return { active, past };
}

export function sortPastRuns<T extends SortableRun>(runs: T[]): T[] {
  return [...runs].sort((a, b) => {
    const rankDiff = (PAST_STATUS_RANK[a.status] ?? 99) - (PAST_STATUS_RANK[b.status] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    const at = a.finishedAt ?? a.startedAt ?? a.createdAt ?? "";
    const bt = b.finishedAt ?? b.startedAt ?? b.createdAt ?? "";
    return new Date(bt).getTime() - new Date(at).getTime();
  });
}
