/** /api/vscode — start VS Code for a session and hand out its one-time link. */
import { existsSync } from "node:fs";
import { Hono } from "hono";
import type { Db } from "../db";
import type { VsCodeProxy } from "./proxy";
import type { VsCodeService } from "./service";

export function createVsCodeRouter(db: Db, service: VsCodeService, proxy: VsCodeProxy) {
  const app = new Hono();

  app.get("/status", (c) => c.json({ data: service.status() }));

  app.post("/tasks/:id", async (c) => {
    const task = db.tasks.getById(c.req.param("id"));
    if (!task) return c.json({ error: "not_found", message: "Sessão não encontrada." }, 404);
    // Runs come newest first: the latest worktree that still exists is the workspace.
    const folder = db.runs
      .listByTask(task.id)
      .map((run) => run.worktreePath)
      .filter((path): path is string => !!path)
      .find((path) => existsSync(path));
    if (!folder) {
      return c.json(
        { error: "no_workspace", message: "Esta sessão ainda não tem workspace no servidor." },
        409
      );
    }
    if (!service.status().available) {
      return c.json(
        { error: "not_installed", message: "code-server não está instalado no servidor." },
        503
      );
    }
    try {
      await service.ensure(task.id, folder);
    } catch (err) {
      return c.json(
        { error: "start_failed", message: err instanceof Error ? err.message : String(err) },
        502
      );
    }
    return c.json({ data: { url: `/vscode/${task.id}/?ticket=${proxy.issueTicket(task.id)}` } });
  });

  app.delete("/tasks/:id", (c) => {
    service.stop(c.req.param("id"));
    return c.json({ data: { ok: true } });
  });

  return app;
}
