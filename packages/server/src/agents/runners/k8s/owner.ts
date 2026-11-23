import { basename } from "node:path";

/** The slice of the database needed to tell whose task a worktree is. */
export interface OwnerLookup {
  runs: { getById(id: string): { taskId: string } | null };
  tasks: { getById(id: string): { repoId: string } | null };
  repos: { getById(id: string): { workspaceId?: string } | null };
}

export const SHARED_OWNER = "default";

/**
 * User (workspace) behind a task worktree. Worktrees live at `workspaces/<repo>/<runId>`;
 * anything unmapped (auth off, legacy repo) shares one owner.
 */
export function taskOwner(db: OwnerLookup, workdir: string): string {
  const run = db.runs.getById(basename(workdir));
  const task = run ? db.tasks.getById(run.taskId) : null;
  const repo = task ? db.repos.getById(task.repoId) : null;
  return repo?.workspaceId || SHARED_OWNER;
}
