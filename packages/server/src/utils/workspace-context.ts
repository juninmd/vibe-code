/**
 * Workspace Context Utilities
 * Handles user → workspace mapping and isolation
 */

import type { AuthUser } from "@vibe-code/shared";
import type { Context } from "hono";
import type { Db } from "../db";

/**
 * Get workspace ID from request context (header or query param)
 * Validates against user's authorized workspaces
 */
export async function getWorkspaceContext(
  c: Context,
  db: Db,
  user: AuthUser | null
): Promise<{ workspaceId: string; userId: string } | null> {
  if (!user) {
    console.warn("[workspace-context] ⚠️  No authenticated user");
    return null;
  }

  // Extract workspace_id from request (priority: header > query)
  const workspaceId = c.req.header("x-workspace-id") || c.req.query("workspace_id");

  if (!workspaceId) {
    console.warn("[workspace-context] ⚠️  Missing workspace_id for user", {
      username: user.username,
    });
    return null;
  }

  // For now: store github_username → workspace_id mapping in settings
  // This is a temporary bridge until users table is fully integrated
  const key = `user_workspace:${user.username}`;
  const authorizedWs = db.settings.get(key);

  // If no mapping exists, create default workspace for this user
  if (!authorizedWs) {
    console.debug("[workspace-context] 📝 Creating default workspace for user", {
      username: user.username,
      workspaceId,
    });
    // Store mapping: this user owns this workspace
    db.settings.set(key, workspaceId);
  } else if (authorizedWs !== workspaceId) {
    // User is trying to access a different workspace than their default
    console.error("[workspace-context] ❌ SECURITY: User attempting cross-workspace access", {
      username: user.username,
      authorizedWs,
      requestedWs: workspaceId,
    });
    return null; // Deny access
  }

  console.debug("[workspace-context] ✅ Workspace context validated", {
    username: user.username,
    workspaceId,
  });

  return {
    workspaceId,
    userId: user.username, // For now, use github username as user ID
  };
}

/**
 * Enforce workspace isolation in request handler
 * Returns 403 if user doesn't have access to requested workspace
 */
export async function requireWorkspaceContext(
  c: Context,
  db: Db,
  user: AuthUser | null
): Promise<string | null> {
  const ctx = await getWorkspaceContext(c, db, user);
  if (!ctx) {
    return null;
  }
  return ctx.workspaceId;
}
