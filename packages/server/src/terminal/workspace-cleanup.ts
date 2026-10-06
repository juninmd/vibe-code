import { readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Db } from "../db";

/** Workspaces that hold a terminal session's (possibly uncommitted) work. */
export function listProtectedWorkspaces(db: Db): Set<string> {
  const rows = db.raw
    .query(
      `SELECT DISTINCT r.worktree_path AS path
         FROM agent_runs r
         JOIN tasks t ON t.id = r.task_id
        WHERE r.current_status = 'terminal'
          AND r.worktree_path IS NOT NULL
          AND t.status NOT IN ('done', 'archived')`
    )
    .all() as Array<{ path: string }>;
  return new Set(rows.map((row) => resolve(row.path)));
}

/**
 * Remove stale headless workspaces (they would exhaust the volume) but never the
 * ones that belong to unfinished terminal sessions: that is the user's work in progress.
 * Layout: <workspaces>/<repo>/<run id>.
 */
export async function cleanupWorkspaces(
  db: Db,
  workspacesPath: string
): Promise<{ removed: number; kept: number }> {
  const protectedPaths = listProtectedWorkspaces(db);
  let removed = 0;
  let kept = 0;

  const repoDirs = await readdir(workspacesPath, { withFileTypes: true }).catch(() => []);
  for (const repoDir of repoDirs) {
    if (!repoDir.isDirectory()) continue;
    const repoPath = join(workspacesPath, repoDir.name);
    const workspaces = await readdir(repoPath, { withFileTypes: true }).catch(() => []);
    let keptInRepo = 0;
    for (const workspace of workspaces) {
      const path = join(repoPath, workspace.name);
      if (protectedPaths.has(resolve(path))) {
        kept++;
        keptInRepo++;
        continue;
      }
      await rm(path, { recursive: true, force: true });
      removed++;
    }
    if (keptInRepo === 0) await rm(repoPath, { recursive: true, force: true });
  }
  return { removed, kept };
}
