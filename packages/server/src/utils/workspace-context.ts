/**
 * Workspace context: which workspace a request works in, and whether the
 * signed-in account owns it (issue #262).
 *
 * Every OAuth session carries an internal `accountId`. The account owns
 * workspaces (`workspaces.owner_account_id`); a request may only target a
 * workspace it owns. Omitting the workspace selects the account's default
 * workspace, created on first use.
 *
 * API-key access never reaches this module - the operator scope is handled by
 * `security/access-control.ts`.
 */
import type { AuthUser } from "@vibe-code/shared";
import type { Context } from "hono";
import type { Db } from "../db";

function uniqueSlug(db: Db, base: string, suffix: string): string {
  const root = `${base}-${suffix}`.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!db.workspaces.getBySlug(root)) return root;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${root}-${i}`;
    if (!db.workspaces.getBySlug(candidate)) return candidate;
  }
  throw new Error("Could not allocate a workspace slug");
}

function defaultWorkspace(db: Db, accountId: string, user: AuthUser): string {
  const existing = db.workspaces.listByOwner(accountId)[0];
  if (existing) return existing.id;
  const id = `ws-${accountId.replace(/^acc-/, "").slice(0, 12)}`;
  if (db.workspaces.get(id)) return id;
  db.workspaces.create({
    id,
    name: user.displayName?.trim() || user.username,
    slug: uniqueSlug(db, "personal", accountId.replace(/^acc-/, "").slice(0, 8)),
    description: "Workspace pessoal",
    ownerAccountId: accountId,
  });
  return id;
}

/**
 * Get the workspace for this request, or null when it is not owned by the
 * caller (403 at the API layer).
 */
export async function getWorkspaceContext(
  c: Context,
  db: Db,
  user: AuthUser | null
): Promise<{ workspaceId: string; userId: string } | null> {
  if (!user) return null;
  const accountId = user.accountId;
  if (!accountId) return null;

  const workspaceIdFromHeader = c.req.header("x-workspace-id");
  const workspaceIdFromQuery = c.req.query("workspace_id");
  const workspaceIdFromEnv = (c.env as { workspaceId?: string } | undefined)?.workspaceId;
  let workspaceId = workspaceIdFromEnv || workspaceIdFromHeader || workspaceIdFromQuery;

  if (!workspaceId && c.req.method !== "GET") {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { workspace_id?: string };
      workspaceId = body?.workspace_id;
    } catch {
      // ignore invalid JSON in non-GET requests
    }
  }

  if (workspaceId) {
    const workspace = db.workspaces.get(workspaceId);
    if (!workspace || workspace.ownerAccountId !== accountId) {
      console.warn("[workspace-context] denied cross-account workspace access", {
        accountId,
        workspaceId,
      });
      return null;
    }
    return { workspaceId, userId: accountId };
  }

  return { workspaceId: defaultWorkspace(db, accountId, user), userId: accountId };
}

/** Enforce workspace isolation in a request handler. */
export async function requireWorkspaceContext(
  c: Context,
  db: Db,
  user: AuthUser | null
): Promise<string | null> {
  const ctx = await getWorkspaceContext(c, db, user);
  return ctx?.workspaceId ?? null;
}
