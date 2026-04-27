import type { Workspace } from "@vibe-code/shared";
import { Hono } from "hono";
import { z } from "zod";

const router = new Hono();

/**
 * GET /api/workspaces — List all workspaces for current user
 * (In production, would check user_id from JWT/session)
 */
router.get("/", async (c) => {
  try {
    // TODO: Get current user from context/JWT
    // For now, return mock workspaces
    const workspaces: Workspace[] = [
      {
        id: "ws-1",
        name: "Personal",
        slug: "personal",
        description: "My personal workspace",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

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

    // TODO: Verify user has access to this workspace
    const workspace: Workspace = {
      id,
      name: "Personal",
      slug: "personal",
      description: "My personal workspace",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

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

    // TODO: Validate slug is unique
    // TODO: Create workspace in database
    // TODO: Add current user as owner

    const workspace: Workspace = {
      id: `ws-${Date.now()}`,
      name: validated.name,
      slug: validated.slug,
      description: validated.description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

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

export default router;
