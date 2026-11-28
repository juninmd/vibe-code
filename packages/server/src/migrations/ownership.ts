/**
 * Ownership migration (issue #262).
 *
 * The production rollout needs an explicit workspace -> account map, a dry run
 * that reports every orphan/conflict, and an idempotent application. Nothing is
 * inferred from login order or e-mail similarity: a workspace without a mapping
 * stays locked and shows up as a migration issue for the operator.
 *
 * Repository ownership derives from the workspace, tasks from the repository,
 * artifacts from the session and schedules from the task, so only the workspace
 * pointers are written here. Repositories without a workspace and tasks whose
 * repository is missing are reported instead of guessed.
 */
import type { Db } from "../db";

export type OwnershipIssueKind =
  | "unmapped_workspace"
  | "unknown_account"
  | "workspace_conflict"
  | "orphan_repository"
  | "orphan_task"
  | "duplicate_mapping";

export interface OwnershipIssue {
  kind: OwnershipIssueKind;
  id: string;
  detail: string;
}

export interface OwnershipMigrationReport {
  dryRun: boolean;
  startedAt: string;
  counts: {
    workspaces: number;
    accounts: number;
    repositories: number;
    tasks: number;
  };
  planned: Array<{
    workspaceId: string;
    accountId: string;
    repositories: number;
    tasks: number;
  }>;
  issues: OwnershipIssue[];
  applied: {
    workspaces: number;
    projectsCreated: number;
    projectsLinked: number;
    tasksLinked: number;
  };
  /** True when the operator can apply the map without leaving orphans behind. */
  ready: boolean;
}

export interface OwnershipMigrationOptions {
  dryRun: boolean;
  /** Keep the migration from writing when any issue is present. Default true. */
  blockOnIssues?: boolean;
}

function repoProjectId(repoId: string): string {
  return `proj-${repoId}`;
}

export function migrateOwnership(
  db: Db,
  mapping: Record<string, string>,
  options: OwnershipMigrationOptions = { dryRun: true }
): OwnershipMigrationReport {
  const dryRun = options.dryRun !== false;
  const blockOnIssues = options.blockOnIssues !== false;
  const issues: OwnershipIssue[] = [];
  const planned: OwnershipMigrationReport["planned"] = [];

  const workspaces = db.raw
    .query<{ id: string; owner_account_id: string | null }, []>(
      "SELECT id, owner_account_id FROM workspaces ORDER BY created_at"
    )
    .all();
  const accounts = new Set(
    db.raw
      .query<{ id: string }, []>("SELECT id FROM accounts")
      .all()
      .map((row) => row.id)
  );
  const repos = db.raw
    .query<{ id: string; workspace_id: string | null }, []>(
      "SELECT id, workspace_id FROM repositories"
    )
    .all();
  const tasks = db.raw
    .query<{ id: string; repo_id: string; project_id: string | null }, []>(
      "SELECT id, repo_id, project_id FROM tasks"
    )
    .all();

  const seen = new Set<string>();
  for (const workspaceId of Object.keys(mapping)) {
    if (seen.has(workspaceId)) {
      issues.push({
        kind: "duplicate_mapping",
        id: workspaceId,
        detail: "Workspace appears twice in the map",
      });
    }
    seen.add(workspaceId);
  }

  for (const repo of repos) {
    if (!repo.workspace_id) {
      issues.push({
        kind: "orphan_repository",
        id: repo.id,
        detail: "Repository has no workspace; map it manually before applying",
      });
    }
  }

  const repoById = new Map(repos.map((repo) => [repo.id, repo]));
  for (const task of tasks) {
    const repo = repoById.get(task.repo_id);
    if (!repo) {
      issues.push({
        kind: "orphan_task",
        id: task.id,
        detail: "Task points at a repository that no longer exists",
      });
    }
  }

  for (const workspace of workspaces) {
    const accountId = mapping[workspace.id];
    if (!accountId) {
      issues.push({
        kind: "unmapped_workspace",
        id: workspace.id,
        detail: "No workspace -> account entry in the map; access stays blocked",
      });
      continue;
    }
    if (!accounts.has(accountId)) {
      issues.push({
        kind: "unknown_account",
        id: workspace.id,
        detail: `Mapped account ${accountId} does not exist`,
      });
      continue;
    }
    if (workspace.owner_account_id && workspace.owner_account_id !== accountId) {
      issues.push({
        kind: "workspace_conflict",
        id: workspace.id,
        detail: `Workspace already belongs to ${workspace.owner_account_id}`,
      });
      continue;
    }
    const workspaceRepos = repos.filter((repo) => repo.workspace_id === workspace.id);
    const workspaceRepoIds = new Set(workspaceRepos.map((repo) => repo.id));
    planned.push({
      workspaceId: workspace.id,
      accountId,
      repositories: workspaceRepos.length,
      tasks: tasks.filter((task) => workspaceRepoIds.has(task.repo_id)).length,
    });
  }

  const report: OwnershipMigrationReport = {
    dryRun,
    startedAt: new Date().toISOString(),
    counts: {
      workspaces: workspaces.length,
      accounts: accounts.size,
      repositories: repos.length,
      tasks: tasks.length,
    },
    planned,
    issues,
    applied: { workspaces: 0, projectsCreated: 0, projectsLinked: 0, tasksLinked: 0 },
    ready: issues.length === 0,
  };

  if (dryRun || (blockOnIssues && issues.length > 0)) return report;

  db.raw.transaction(() => {
    for (const entry of report.planned) {
      const changed = db.raw
        .prepare(
          "UPDATE workspaces SET owner_account_id = ?, updated_at = datetime('now') WHERE id = ? AND owner_account_id IS NULL"
        )
        .run(entry.accountId, entry.workspaceId);
      report.applied.workspaces += Number(changed.changes ?? 0);

      for (const repo of repos.filter((item) => item.workspace_id === entry.workspaceId)) {
        const projectId = repoProjectId(repo.id);
        const existingProject = db.raw
          .query<{ id: string }, [string]>("SELECT id FROM projects WHERE id = ?")
          .get(projectId);
        if (!existingProject) {
          db.raw
            .prepare(
              "INSERT INTO projects (id, workspace_id, name, description) VALUES (?, ?, ?, ?)"
            )
            .run(projectId, entry.workspaceId, repo.id, "Projeto inicial da migração de ownership");
          report.applied.projectsCreated += 1;
        }
        const linked = db.raw
          .prepare("INSERT OR IGNORE INTO project_repositories (project_id, repo_id) VALUES (?, ?)")
          .run(projectId, repo.id);
        report.applied.projectsLinked += Number(linked.changes ?? 0);
        const taskUpdate = db.raw
          .prepare(
            "UPDATE tasks SET project_id = ?, updated_at = datetime('now') WHERE repo_id = ? AND (project_id IS NULL OR project_id != ?)"
          )
          .run(projectId, repo.id, projectId);
        report.applied.tasksLinked += Number(taskUpdate.changes ?? 0);
      }
    }
  })();

  return report;
}

/** Human-readable report for the CLI and the operator log. */
export function formatOwnershipReport(report: OwnershipMigrationReport): string {
  const lines: string[] = [];
  lines.push(
    `ownership migration ${report.dryRun ? "(dry run)" : "(applied)"} at ${report.startedAt}`
  );
  lines.push(
    `workspaces=${report.counts.workspaces} accounts=${report.counts.accounts} repositories=${report.counts.repositories} tasks=${report.counts.tasks}`
  );
  lines.push(`ready=${report.ready}`);
  for (const entry of report.planned) {
    lines.push(
      `  plan ${entry.workspaceId} -> ${entry.accountId} (repositories=${entry.repositories}, tasks=${entry.tasks})`
    );
  }
  for (const issue of report.issues) {
    lines.push(`  ISSUE ${issue.kind} ${issue.id}: ${issue.detail}`);
  }
  if (!report.dryRun) {
    lines.push(
      `  applied workspaces=${report.applied.workspaces} projectsCreated=${report.applied.projectsCreated} projectsLinked=${report.applied.projectsLinked} tasksLinked=${report.applied.tasksLinked}`
    );
  }
  return lines.join("\n");
}
