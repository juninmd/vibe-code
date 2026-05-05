import type { Workspace } from "@vibe-code/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";

export function createWorkspacesRouter(db: Db) {
  const router = new Hono();

  /**
   * GET /api/workspaces — List all workspaces for current user
   */
  router.get("/", async (c) => {
    try {
      let workspaces = db.workspaces.list();

      // Auto-create default workspace if none exist
      if (workspaces.length === 0) {
        const defaultWorkspace = db.workspaces.create({
          name: "Personal",
          slug: "personal",
          description: "My personal workspace",
        });
        workspaces = [defaultWorkspace];
      }

      console.debug("[API] Fetched workspaces", {
        count: workspaces.length,
      });

      return c.json(workspaces);
    } catch (error) {
      console.error("[API] Error fetching workspaces", error);
      return c.json({ error: "Failed to fetch workspaces" }, { status: 500 });
    }
  });

  /**
   * GET /api/workspaces/:id — Get single workspace by ID
   */
  router.get("/:id", async (c) => {
    try {
      const { id } = c.req.param();

      const workspace = db.workspaces.get(id);

      if (!workspace) {
        return c.json({ error: "Workspace not found" }, { status: 404 });
      }

      console.debug("[API] Fetched workspace", {
        id,
        name: workspace.name,
      });

      return c.json(workspace);
    } catch (error) {
      console.error("[API] Error fetching workspace", error);
      return c.json({ error: "Failed to fetch workspace" }, { status: 500 });
    }
  });

  /**
   * POST /api/workspaces — Create new workspace
   */
  router.post("/", async (c) => {
    try {
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
