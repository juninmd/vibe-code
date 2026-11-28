import type { AgentRun, TaskWithRun } from "@vibe-code/shared";
import type { Context } from "hono";
import { checkApiKey, getCurrentUser, isAuthEnabled as isAuthConfigured } from "../auth";
import type { Db } from "../db";
import { requireWorkspaceContext } from "../utils/workspace-context";

export interface AccessContext {
  authEnabled: boolean;
  userId: string | null;
  workspaceId: string | null;
}

interface AccessDecision {
  allowed: boolean;
  status: 400 | 401 | 403 | 404;
  code: string;
  message: string;
}

interface ResolveAccessResult {
  ok: boolean;
  context?: AccessContext;
  error?: AccessDecision;
}

function isAuthEnabled(db: Db): boolean {
  const status = db.settings.get("auth_enabled");
  if (status === "false") return false;
  return isAuthConfigured();
}

function isLegacyFallbackEnabled(db: Db): boolean {
  if (process.env.VIBE_CODE_SECURITY_LEGACY_FALLBACK === "true") return true;
  return db.settings.get("security_legacy_workspace_fallback") === "true";
}

function canAccessRepoInWorkspace(db: Db, repoId: string, workspaceId: string): boolean {
  const repo = db.repos.getById(repoId);
  return repo?.workspaceId === workspaceId;
}

function bindRepoToWorkspace(db: Db, repoId: string, workspaceId: string): void {
  db.raw
    .prepare("UPDATE repositories SET workspace_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(workspaceId, repoId);
}

export function claimUnmappedRepoForWorkspace(
  db: Db,
  context: AccessContext,
  repoId: string
): boolean {
  if (!context.authEnabled || !context.workspaceId) return true;
  const repo = db.repos.getById(repoId);
  if (!repo) return false;
  if (repo.workspaceId) return false;

  bindRepoToWorkspace(db, repoId, context.workspaceId);
  console.info("[security] Mapped previously unowned repo to workspace", {
    repoId,
    workspaceId: context.workspaceId,
    userId: context.userId,
  });
  return true;
}

export async function resolveAccessContext(c: Context, db: Db): Promise<ResolveAccessResult> {
  const authEnabled = isAuthEnabled(db);
  if (!authEnabled) {
    return {
      ok: true,
      context: { authEnabled: false, userId: null, workspaceId: null },
    };
  }

  // API key auth: grant global access when a valid API key is presented. An
  // explicit workspace header scopes the operator to that workspace, which is
  // what the projects flow needs to attach repositories.
  if (checkApiKey(c)) {
    const requested = c.req.header("x-workspace-id") ?? c.req.query("workspace_id");
    const workspace = requested ? db.workspaces.get(requested) : null;
    return {
      ok: true,
      context: {
        authEnabled: Boolean(workspace),
        userId: null,
        workspaceId: workspace?.id ?? null,
      },
    };
  }

  const user = getCurrentUser(db, c);
  if (!user) {
    return {
      ok: false,
      error: {
        allowed: false,
        status: 401,
        code: "unauthorized",
        message: "Authentication required",
      },
    };
  }

  const workspaceId = await requireWorkspaceContext(c, db, user);
  if (!workspaceId) {
    return {
      ok: false,
      error: {
        allowed: false,
        status: 403,
        code: "workspace_forbidden",
        message: "Workspace access denied",
      },
    };
  }

  return {
    ok: true,
    context: {
      authEnabled: true,
      userId: user.username,
      workspaceId,
    },
  };
}

export function enforceRepoAccess(
  db: Db,
  context: AccessContext,
  repoId: string
): AccessDecision | null {
  if (!context.authEnabled || !context.workspaceId) return null;

  if (canAccessRepoInWorkspace(db, repoId, context.workspaceId)) {
    return null;
  }

  if (isLegacyFallbackEnabled(db)) {
    bindRepoToWorkspace(db, repoId, context.workspaceId);
    console.warn("[security] WARN: Legacy fallback mapped repo to workspace", {
      repoId,
      workspaceId: context.workspaceId,
      userId: context.userId,
    });
    return null;
  }

  return {
    allowed: false,
    status: 403,
    code: "repo_forbidden",
    message: "Repository access denied",
  };
}

export function enforceTaskAccess(
  db: Db,
  context: AccessContext,
  taskId: string
): AccessDecision | null {
  const task = db.tasks.getById(taskId);
  if (!task) {
    return {
      allowed: false,
      status: 404,
      code: "not_found",
      message: "Task not found",
    };
  }
  return enforceRepoAccess(db, context, task.repoId);
}

export function enforceRunAccess(
  db: Db,
  context: AccessContext,
  runId: string
): AccessDecision | null {
  const run = db.runs.getById(runId);
  if (!run) {
    return {
      allowed: false,
      status: 404,
      code: "not_found",
      message: "Run not found",
    };
  }
  return enforceTaskAccess(db, context, run.taskId);
}

export function sanitizeRunForExternal(db: Db, run: AgentRun): AgentRun {
  const expose =
    process.env.VIBE_CODE_EXPOSE_WORKTREE_PATH === "true" ||
    db.settings.get("expose_worktree_path") === "true";

  if (expose) return run;
  return {
    ...run,
    worktreePath: null,
    stateSnapshot: withoutWorktreePath(run.stateSnapshot),
  };
}

/** The resume snapshot repeats the worktree path; hide it there as well. */
function withoutWorktreePath(snapshot: string | null | undefined): string | null | undefined {
  if (!snapshot?.includes("worktreePath")) return snapshot;
  try {
    const { worktreePath: _hidden, ...rest } = JSON.parse(snapshot) as Record<string, unknown>;
    return JSON.stringify(rest);
  } catch {
    return snapshot;
  }
}

export function sanitizeTaskForExternal<T extends TaskWithRun>(db: Db, task: T): T {
  if (!task.latestRun) return task;
  return {
    ...task,
    latestRun: sanitizeRunForExternal(db, task.latestRun),
  };
}

export function asForbiddenResponse(decision: AccessDecision): { error: string; message: string } {
  return { error: decision.code, message: decision.message };
}
