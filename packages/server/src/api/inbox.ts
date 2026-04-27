import { Hono } from "hono";
import type { Orchestrator } from "../agents/orchestrator";
import type { EngineRegistry } from "../agents/registry";
import type { Db } from "../db";

type InboxSeverity = "info" | "warning" | "critical" | "success";

interface RawTaskSignal {
  id: string;
  title: string;
  status: string;
  repo_id: string;
  repo_name: string;
  engine: string | null;
  pr_url: string | null;
  updated_at: string;
}

function buildTaskItem(
  type: string,
  severity: InboxSeverity,
  task: RawTaskSignal,
  description: string
) {
  return {
    id: `${type}:${task.id}`,
    type,
    severity,
    title: task.title,
    description,
    taskId: task.id,
    repoId: task.repo_id,
    repoName: task.repo_name,
    createdAt: task.updated_at,
    actionLabel: "Abrir tarefa",
  };
}

export function createInboxRouter(db: Db, registry: EngineRegistry, orchestrator: Orchestrator) {
  const router = new Hono();

  router.get("/", async (c) => {
    const raw = db.raw;
    const items = [];

    const failedTasks = raw
      .query(
        `SELECT t.id, t.title, t.status, t.repo_id, r.name as repo_name, t.engine, t.pr_url, t.updated_at
         FROM tasks t
         JOIN repositories r ON r.id = t.repo_id
         WHERE t.status = 'failed'
         ORDER BY t.updated_at DESC
         LIMIT 20`
      )
      .all() as RawTaskSignal[];

    for (const task of failedTasks) {
      items.push(
        buildTaskItem(
          "task_failed",
          "critical",
          task,
          `Falha em ${task.repo_name}${task.engine ? ` usando ${task.engine}` : ""}.`
        )
      );
    }

    const reviewTasks = raw
      .query(
        `SELECT t.id, t.title, t.status, t.repo_id, r.name as repo_name, t.engine, t.pr_url, t.updated_at
         FROM tasks t
         JOIN repositories r ON r.id = t.repo_id
         WHERE t.status = 'review'
         ORDER BY t.updated_at DESC
         LIMIT 20`
      )
      .all() as RawTaskSignal[];

    for (const task of reviewTasks) {
      items.push(
        buildTaskItem(
          "task_review",
          "success",
          task,
          task.pr_url ? `PR pronto em ${task.repo_name}.` : `Tarefa em review em ${task.repo_name}.`
        )
      );
    }

    const runningTasks = raw
      .query(
        `SELECT t.id, t.title, t.status, t.repo_id, r.name as repo_name, t.engine, t.pr_url, t.updated_at
         FROM tasks t
         JOIN repositories r ON r.id = t.repo_id
         WHERE t.status = 'in_progress'
         ORDER BY t.updated_at DESC
         LIMIT 20`
      )
      .all() as RawTaskSignal[];

    for (const task of runningTasks) {
      items.push(
        buildTaskItem(
          "task_running",
          "info",
          task,
          `Execucao ativa em ${task.repo_name}${task.engine ? ` com ${task.engine}` : ""}.`
        )
      );
    }

    const activeRuns = orchestrator.getActiveRunEngines();
    const engines = await registry.listEngines(activeRuns);
    const unavailable = engines.filter((engine) => !engine.available);

    for (const engine of unavailable) {
      items.push({
        id: `engine_unavailable:${engine.name}`,
        type: "engine_unavailable",
        severity: engine.setupIssue ? "warning" : "info",
        title: `${engine.displayName} indisponivel`,
        description: engine.setupIssue ?? "CLI nao encontrado neste runtime local.",
        taskId: null,
        repoId: null,
        repoName: null,
        createdAt: new Date().toISOString(),
        actionLabel: "Abrir engines",
      });
    }

    if (orchestrator.activeCount >= Number(process.env.VIBE_CODE_MAX_AGENTS || 4)) {
      items.push({
        id: "runtime_saturated:local",
        type: "runtime_saturated",
        severity: "warning",
        title: "Runtime local saturado",
        description: "Todos os slots de agentes estao em uso.",
        taskId: null,
        repoId: null,
        repoName: null,
        createdAt: new Date().toISOString(),
        actionLabel: "Abrir runtimes",
      });
    }

    items.sort((a, b) => {
      const severityRank: Record<InboxSeverity, number> = {
        critical: 0,
        warning: 1,
        success: 2,
        info: 3,
      };
      return (
        severityRank[a.severity as InboxSeverity] - severityRank[b.severity as InboxSeverity] ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });

    return c.json({ data: items.slice(0, 50) });
  });

  return router;
}
