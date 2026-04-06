import { Hono } from "hono";
import type { Db } from "../db";

export function createStatsRouter(db: Db) {
  const app = new Hono();

  app.get("/", (c) => {
    const raw = db.raw;

    // Overview
    const totalRepos = (raw.query("SELECT COUNT(*) as c FROM repositories").get() as any).c;
    const totalTasks = (raw.query("SELECT COUNT(*) as c FROM tasks").get() as any).c;
    const totalRuns = (raw.query("SELECT COUNT(*) as c FROM agent_runs").get() as any).c;
    const completedRuns = (
      raw.query("SELECT COUNT(*) as c FROM agent_runs WHERE status = 'completed'").get() as any
    ).c;
    const failedRuns = (
      raw.query("SELECT COUNT(*) as c FROM agent_runs WHERE status = 'failed'").get() as any
    ).c;
    const successRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;

    // Average run duration (seconds)
    const avgDuration =
      (
        raw
          .query(
            `SELECT AVG(
            CAST((julianday(finished_at) - julianday(started_at)) * 86400 AS REAL)
          ) as avg_secs
          FROM agent_runs
          WHERE started_at IS NOT NULL AND finished_at IS NOT NULL`
          )
          .get() as any
      )?.avg_secs ?? 0;

    // PR stats
    const totalPRsCreated = (
      raw
        .query("SELECT COUNT(*) as c FROM tasks WHERE pr_url IS NOT NULL AND pr_url != ''")
        .get() as any
    ).c;
    const totalPRsMerged = (
      raw
        .query(
          "SELECT COUNT(*) as c FROM tasks WHERE pr_url IS NOT NULL AND pr_url != '' AND status = 'done'"
        )
        .get() as any
    ).c;

    // Tasks by status
    const tasksByStatus = raw
      .query("SELECT status, COUNT(*) as count FROM tasks GROUP BY status ORDER BY count DESC")
      .all() as { status: string; count: number }[];

    // Tasks by repo
    const tasksByRepo = raw
      .query(
        `SELECT
          r.id as repo_id,
          r.name as repo_name,
          COUNT(t.id) as total,
          SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done,
          SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM repositories r
        LEFT JOIN tasks t ON t.repo_id = r.id
        GROUP BY r.id
        ORDER BY total DESC
        LIMIT 20`
      )
      .all() as {
      repo_id: string;
      repo_name: string;
      total: number;
      done: number;
      failed: number;
    }[];

    // Runs by engine
    const runsByEngine = raw
      .query(
        `SELECT
          engine,
          COUNT(*) as runs,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          AVG(
            CASE WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
              THEN CAST((julianday(finished_at) - julianday(started_at)) * 86400 AS REAL)
              ELSE NULL END
          ) as avg_duration_secs
        FROM agent_runs
        GROUP BY engine
        ORDER BY runs DESC`
      )
      .all() as {
      engine: string;
      runs: number;
      completed: number;
      failed: number;
      avg_duration_secs: number | null;
    }[];

    // Runs by model (from tasks table)
    const runsByModel = raw
      .query(
        `SELECT
          COALESCE(t.model, 'default') as model,
          COUNT(ar.id) as runs
        FROM agent_runs ar
        JOIN tasks t ON t.id = ar.task_id
        GROUP BY t.model
        ORDER BY runs DESC
        LIMIT 15`
      )
      .all() as { model: string; runs: number }[];

    // Daily activity (last 30 days)
    const dailyActivity = raw
      .query(
        `SELECT
          date(created_at) as date,
          COUNT(*) as runs,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM agent_runs
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY date(created_at)
        ORDER BY date ASC`
      )
      .all() as { date: string; runs: number; completed: number; failed: number }[];

    // Favorites
    const favoriteEngine = runsByEngine.length > 0 ? runsByEngine[0].engine : null;
    const favoriteModel =
      runsByModel.length > 0 && runsByModel[0].model !== "default"
        ? runsByModel[0].model
        : runsByModel.length > 1
          ? (runsByModel[1]?.model ?? null)
          : null;

    return c.json({
      data: {
        overview: {
          totalRepos,
          totalTasks,
          totalRuns,
          successRate,
          avgRunDurationSecs: Math.round(avgDuration),
          totalPRsCreated,
          totalPRsMerged,
        },
        tasksByStatus,
        tasksByRepo: tasksByRepo.map((r) => ({
          repoId: r.repo_id,
          repoName: r.repo_name,
          total: r.total,
          done: r.done,
          failed: r.failed,
        })),
        runsByEngine: runsByEngine.map((e) => ({
          engine: e.engine,
          runs: e.runs,
          completed: e.completed,
          failed: e.failed,
          avgDurationSecs: Math.round(e.avg_duration_secs ?? 0),
        })),
        runsByModel: runsByModel.map((m) => ({
          model: m.model,
          runs: m.runs,
        })),
        dailyActivity,
        favoriteEngine,
        favoriteModel,
      },
    });
  });

  return app;
}
