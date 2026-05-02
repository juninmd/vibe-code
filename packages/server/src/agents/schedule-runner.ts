import { Cron } from "croner";
import type { Db } from "../db";
import type { SkillRegistryService } from "../skills/registry";
import type { Orchestrator } from "./orchestrator";

export class ScheduleRunner {
  private cron: Cron | null = null;
  private lastHygieneAt = 0;

  constructor(
    private db: Db,
    private orchestrator: Orchestrator,
    private skillRegistry?: SkillRegistryService
  ) {}

  start(): void {
    this.cron = new Cron("* * * * *", { protect: true }, () => this.tick());
    console.log("  ↻ Schedule runner started (checks every minute)");
  }

  stop(): void {
    this.cron?.stop();
  }

  private async tick(): Promise<void> {
    // Disable schedules whose deadline has passed
    this.db.schedules.disableExpired();

    // 1. Check for scheduled tasks
    const due = this.db.schedules.listDue();
    for (const schedule of due) {
      try {
        await this.orchestrator.triggerScheduled(schedule.taskId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ Schedule trigger failed for task ${schedule.taskId}: ${msg}`);
      } finally {
        // Always advance next_run_at to avoid hammering a broken/busy task
        const next = new Cron(schedule.cronExpression).nextRun();
        this.db.schedules.updateAfterRun(schedule.taskId, next ? next.toISOString() : null);
        console.log(
          `  ↻ Scheduled task ${schedule.taskId} triggered, next: ${next?.toISOString() ?? "none"}`
        );
      }
    }

    // 2. Continuous Autonomy / Heartbeat: Sweep backlog for work stealing
    await this.orchestrator.sweepBacklog();

    const HYGIENE_INTERVAL_MS = 15 * 60 * 1000;
    if (this.skillRegistry && Date.now() - this.lastHygieneAt >= HYGIENE_INTERVAL_MS) {
      this.lastHygieneAt = Date.now();
      const report = await this.skillRegistry.generateHygieneReport(this.db);
      this.db.settings.set("system_hygiene_report", JSON.stringify(report));
      console.log(
        `  ↻ Hygiene report updated pending=${report.pendingRegistryReviews} memories=${report.memoriesNeedingCompaction} blocked=${report.blockedByFailedDependencies}`
      );
    }
  }
}
