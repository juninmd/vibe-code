import { cpus, hostname, platform, release, uptime } from "node:os";
import { Hono } from "hono";
import type { Orchestrator } from "../agents/orchestrator";
import type { EngineRegistry } from "../agents/registry";
import type { Db } from "../db";

function formatRuntimeId() {
  return `${hostname().toLowerCase()}-${platform()}`;
}

export function createRuntimesRouter(
  db: Db,
  registry: EngineRegistry,
  orchestrator: Orchestrator,
  dataDir: string,
  maxAgents: number
) {
  const router = new Hono();

  router.get("/", async (c) => {
    const activeRuns = orchestrator.getActiveRunEngines();
    const engines = await registry.listEngines(activeRuns);
    const now = new Date().toISOString();

    const raw = db.raw;
    const totalTasks = (raw.query("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
    const runningTasks = (
      raw.query("SELECT COUNT(*) as c FROM tasks WHERE status = 'in_progress'").get() as {
        c: number;
      }
    ).c;
    const failedTasks = (
      raw.query("SELECT COUNT(*) as c FROM tasks WHERE status = 'failed'").get() as { c: number }
    ).c;
    const totalRuns = (raw.query("SELECT COUNT(*) as c FROM agent_runs").get() as { c: number }).c;
    const completedRuns = (
      raw.query("SELECT COUNT(*) as c FROM agent_runs WHERE status = 'completed'").get() as {
        c: number;
      }
    ).c;
    const failedRuns = (
      raw.query("SELECT COUNT(*) as c FROM agent_runs WHERE status = 'failed'").get() as {
        c: number;
      }
    ).c;
    const lastRun = raw
      .query("SELECT created_at as createdAt FROM agent_runs ORDER BY created_at DESC LIMIT 1")
      .get() as { createdAt: string } | null;

    const availableEngines = engines.filter((engine) => engine.available).length;
    const activeAgents = orchestrator.activeCount;
    const health =
      activeAgents >= maxAgents
        ? "saturated"
        : availableEngines === 0
          ? "degraded"
          : failedRuns > completedRuns && totalRuns > 0
            ? "degraded"
            : "healthy";

    return c.json({
      data: [
        {
          id: formatRuntimeId(),
          name: hostname(),
          kind: "local",
          status: health,
          lastSeenAt: now,
          platform: `${platform()} ${release()}`,
          cpuCount: cpus().length,
          uptimeSecs: Math.round(uptime()),
          dataDir,
          capacity: {
            activeAgents,
            maxAgents,
            availableEngines,
            totalEngines: engines.length,
          },
          engines,
          workload: {
            totalTasks,
            runningTasks,
            failedTasks,
            totalRuns,
            completedRuns,
            failedRuns,
            lastRunAt: lastRun?.createdAt ?? null,
          },
        },
      ],
    });
  });

  return router;
}
