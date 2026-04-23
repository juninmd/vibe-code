import { Hono } from "hono";

/**
 * Workspace ID enforcement middleware
 * Ensures all requests include and validate workspace context
 * Attaches workspace_id to context for use in handlers
 */
export function workspaceMiddleware() {
  return async (c: any, next: any) => {
    // Skip for public endpoints (auth, health, etc.)
    const publicPaths = [
      "/api/health",
      "/api/auth",
      "/api/workspaces", // listing is allowed without wsId
      "/api/tasks/poll", // polling is public (read-only status)
    ];

    const isPublic = publicPaths.some((path) => c.req.path.startsWith(path));

    if (isPublic) {
      console.debug("[Middleware] 📡 Skipping workspace validation for public route", {
        path: c.req.path,
      });
      return next();
    }

    // For protected endpoints, extract workspace_id
    // Priority: query param > header > body
    const wsIdFromQuery = c.req.query("workspace_id");
    const wsIdFromHeader = c.req.header("x-workspace-id");
    let wsIdFromBody: string | undefined;

    try {
      if (c.req.method !== "GET") {
        const body = await c.req.json().catch(() => ({}));
        wsIdFromBody = body.workspace_id;
      }
    } catch {
      // Ignore JSON parse errors
    }

    const workspaceId = wsIdFromQuery || wsIdFromHeader || wsIdFromBody;

    if (!workspaceId) {
      console.warn("[Middleware] ⚠️  Missing workspace_id for protected endpoint", {
        path: c.req.path,
        method: c.req.method,
      });
      return c.json({ error: "workspace_id is required" }, { status: 400 });
    }

    // Store in context for handler access
    c.env.workspaceId = workspaceId;
    console.debug("[Middleware] 🔒 Workspace context set", {
      workspaceId,
      path: c.req.path,
    });

    return next();
  };
}
