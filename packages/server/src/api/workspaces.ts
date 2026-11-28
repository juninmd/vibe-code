import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { checkApiKey, getCurrentUser, isAuthEnabled } from "../auth";
import type { Db } from "../db";
import { getWorkspaceContext } from "../utils/workspace-context";

type Scope = { operator: true } | { operator: false; accountId: string } | null;

function requestScope(db: Db, c: Context): Scope {
  if (!isAuthEnabled()) return { operator: true };
  if (checkApiKey(c)) return { operator: true };
  const user = getCurrentUser(db, c);
  if (!user?.accountId) return null;
  return { operator: false, accountId: user.accountId };
}

export function createWorkspacesRouter(db: Db) {
  const router = new Hono();

  /**
   * GET /api/workspaces - List the workspaces the caller owns.
   * An account gets its own list (and a default workspace on first use); the
   * operator/API-key scope sees every workspace.
   */
  router.get("/", async (c) => {
    try {
      const scope = requestScope(db, c);
      if (!scope) return c.json({ error: "unauthorized" }, 401);

      if (scope.operator) {
        let workspaces = db.workspaces.list();
        if (workspaces.length === 0) {
          const defaultWorkspace = db.workspaces.create({
            name: "Personal",
            slug: "personal",
            description: "My personal workspace",
          });
          workspaces = [defaultWorkspace];
        }
        return c.json(workspaces);
      }

      const user = getCurrentUser(db, c);
      const ctx = await getWorkspaceContext(c, db, user);
      if (!ctx) return c.json({ error: "unauthorized" }, 401);
      return c.json(db.workspaces.listByOwner(scope.accountId));
    } catch (error) {
      console.error("[API] Error fetching workspaces", error);
      return c.json({ error: "Failed to fetch workspaces" }, { status: 500 });
    }
  });

  /**
   * GET /api/workspaces/:id - Get single workspace by ID (owner only).
   */
  router.get("/:id", async (c) => {
    try {
      const scope = requestScope(db, c);
      if (!scope) return c.json({ error: "unauthorized" }, 401);
      const { id } = c.req.param();

      const workspace = db.workspaces.get(id);
      if (!workspace || (!scope.operator && workspace.ownerAccountId !== scope.accountId)) {
        return c.json({ error: "Workspace not found" }, { status: 404 });
      }

      return c.json(workspace);
    } catch (error) {
      console.error("[API] Error fetching workspace", error);
      return c.json({ error: "Failed to fetch workspace" }, { status: 500 });
    }
  });

  /**
   * POST /api/workspaces - Create new workspace owned by the caller.
   */
  router.post("/", async (c) => {
    try {
      const scope = requestScope(db, c);
      if (!scope) return c.json({ error: "unauthorized" }, 401);

      const CreateWorkspaceSchema = z.object({
        name: z.string().min(1).max(255),
        slug: z.string().min(1).max(255),
        description: z.string().optional(),
      });

      const body = await c.req.json();
      const validated = CreateWorkspaceSchema.parse(body);

      const existing = db.workspaces.getBySlug(validated.slug);
      if (existing) {
        return c.json({ error: "Workspace slug must be unique" }, { status: 400 });
      }

      const workspace = db.workspaces.create({
        name: validated.name,
        slug: validated.slug,
        description: validated.description,
        ownerAccountId: scope.operator ? null : scope.accountId,
      });

      console.info("[API] Created workspace", {
        id: workspace.id,
        name: workspace.name,
      });

      return c.json(workspace, { status: 201 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: "Validation failed", details: error.issues }, { status: 400 });
      }
      console.error("[API] Error creating workspace", error);
      return c.json({ error: "Failed to create workspace" }, { status: 500 });
    }
  });

  return router;
}
