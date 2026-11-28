import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { checkApiKey, getCurrentUser, isAuthEnabled } from "../auth";
import type { Db } from "../db";
import { asForbiddenResponse, resolveAccessContext } from "../security/access-control";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  repoIds: z.array(z.string().min(1)).optional(),
  workspace_id: z.string().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
});

const addRepoSchema = z.object({ repoId: z.string().min(1) });

/** Workspace for the request: account scope wins, operator falls back to the query/first. */
async function resolveWorkspace(
  c: Context,
  db: Db
): Promise<{ workspaceId: string | null; error?: Response }> {
  const access = await resolveAccessContext(c, db);
  if (!access.ok) {
    const error = access.error;
    return {
      workspaceId: null,
      error: error
        ? c.json(asForbiddenResponse(error), error.status)
        : c.json({ error: "unauthorized" }, 401),
    };
  }
  if (access.context?.workspaceId) return { workspaceId: access.context.workspaceId };

  // Operator/API-key scope: explicit workspace, otherwise the oldest one.
  const requested = c.req.query("workspace_id");
  if (requested) return { workspaceId: requested };
  const first = db.workspaces.list().sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (first) return { workspaceId: first.id };
  const created = db.workspaces.create({
    name: "Personal",
    slug: `personal-${Date.now()}`,
    description: "Workspace padrão",
  });
  return { workspaceId: created.id };
}

function projectWithRepos(db: Db, projectId: string) {
  const project = db.projects.get(projectId);
  if (!project) return null;
  return { ...project, repoIds: db.projects.listRepoIds(projectId) };
}

export function createProjectsRouter(db: Db) {
  const router = new Hono();

  router.get("/", async (c) => {
    const resolved = await resolveWorkspace(c, db);
    if (resolved.error) return resolved.error;
    const workspaceId = resolved.workspaceId;
    if (!workspaceId) return c.json({ error: "workspace_required" }, 400);
    const projects = db.projects
      .listByWorkspace(workspaceId)
      .map((project) => ({ ...project, repoIds: db.projects.listRepoIds(project.id) }));
    return c.json({ data: projects });
  });

  router.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }
    const resolved = await resolveWorkspace(c, db);
    if (resolved.error) return resolved.error;
    const workspaceId = resolved.workspaceId;
    if (!workspaceId) return c.json({ error: "workspace_required" }, 400);

    const repoIds = [...new Set(parsed.data.repoIds ?? [])];
    for (const repoId of repoIds) {
      const repo = db.repos.getById(repoId);
      if (!repo || repo.workspaceId !== workspaceId) {
        return c.json(
          { error: "repo_forbidden", message: "Repository is not in this workspace" },
          403
        );
      }
    }

    const project = db.projects.create({
      workspaceId,
      name: parsed.data.name,
      description: parsed.data.description,
    });
    for (const repoId of repoIds) db.projects.addRepo(project.id, repoId);
    return c.json({ data: projectWithRepos(db, project.id) }, 201);
  });

  router.get("/:id", async (c) => {
    const project = projectWithRepos(db, c.req.param("id"));
    if (!project) return c.json({ error: "not_found", message: "Project not found" }, 404);
    const access = await resolveAccessContext(c, db);
    if (!access.ok) {
      const error = access.error;
      return error
        ? c.json(asForbiddenResponse(error), error.status)
        : c.json({ error: "unauthorized" }, 401);
    }
    if (access.context?.workspaceId && project.workspaceId !== access.context.workspaceId) {
      return c.json({ error: "forbidden", message: "Project access denied" }, 403);
    }
    return c.json({ data: project });
  });

  router.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const project = db.projects.get(id);
    if (!project) return c.json({ error: "not_found", message: "Project not found" }, 404);
    const access = await resolveAccessContext(c, db);
    if (!access.ok) {
      const error = access.error;
      return error
        ? c.json(asForbiddenResponse(error), error.status)
        : c.json({ error: "unauthorized" }, 401);
    }
    if (access.context?.workspaceId && project.workspaceId !== access.context.workspaceId) {
      return c.json({ error: "forbidden", message: "Project access denied" }, 403);
    }
    const parsed = updateProjectSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }
    db.projects.update(id, parsed.data);
    return c.json({ data: projectWithRepos(db, id) });
  });

  router.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const project = db.projects.get(id);
    if (!project) return c.json({ error: "not_found", message: "Project not found" }, 404);
    const access = await resolveAccessContext(c, db);
    if (!access.ok) {
      const error = access.error;
      return error
        ? c.json(asForbiddenResponse(error), error.status)
        : c.json({ error: "unauthorized" }, 401);
    }
    if (access.context?.workspaceId && project.workspaceId !== access.context.workspaceId) {
      return c.json({ error: "forbidden", message: "Project access denied" }, 403);
    }
    db.projects.remove(id);
    return c.json({ data: { ok: true } });
  });

  router.post("/:id/repos", async (c) => {
    const id = c.req.param("id");
    const project = db.projects.get(id);
    if (!project) return c.json({ error: "not_found", message: "Project not found" }, 404);
    const access = await resolveAccessContext(c, db);
    if (!access.ok) {
      const error = access.error;
      return error
        ? c.json(asForbiddenResponse(error), error.status)
        : c.json({ error: "unauthorized" }, 401);
    }
    if (access.context?.workspaceId && project.workspaceId !== access.context.workspaceId) {
      return c.json({ error: "forbidden", message: "Project access denied" }, 403);
    }
    const parsed = addRepoSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }
    const repo = db.repos.getById(parsed.data.repoId);
    if (!repo || repo.workspaceId !== project.workspaceId) {
      return c.json(
        { error: "repo_forbidden", message: "Repository is not in this workspace" },
        403
      );
    }
    db.projects.addRepo(id, repo.id);
    return c.json({ data: projectWithRepos(db, id) }, 201);
  });

  router.delete("/:id/repos/:repoId", async (c) => {
    const id = c.req.param("id");
    const project = db.projects.get(id);
    if (!project) return c.json({ error: "not_found", message: "Project not found" }, 404);
    const access = await resolveAccessContext(c, db);
    if (!access.ok) {
      const error = access.error;
      return error
        ? c.json(asForbiddenResponse(error), error.status)
        : c.json({ error: "unauthorized" }, 401);
    }
    if (access.context?.workspaceId && project.workspaceId !== access.context.workspaceId) {
      return c.json({ error: "forbidden", message: "Project access denied" }, 403);
    }
    db.projects.removeRepo(id, c.req.param("repoId"));
    return c.json({ data: projectWithRepos(db, id) });
  });

  return router;
}

/** Account-only credential management: the operator key cannot impersonate an account. */
export function accountScope(db: Db, c: Context): { accountId: string } | { error: Response } {
  if (!isAuthEnabled()) return { error: c.json({ error: "account_required" }, 400) };
  if (checkApiKey(c)) return { error: c.json({ error: "account_required" }, 400) };
  const user = getCurrentUser(db, c);
  if (!user?.accountId) return { error: c.json({ error: "unauthorized" }, 401) };
  return { accountId: user.accountId };
}
