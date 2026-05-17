import { Cron } from "croner";
import type { Db } from "../db";
import type { SkillRegistryService } from "../skills/registry";
import { ConflictResolver } from "./conflict-resolver";
import type { Orchestrator } from "./orchestrator";

export class ScheduleRunner {
  private cron: Cron | null = null;
  private lastHygieneAt = 0;
  private conflictResolver: ConflictResolver;

  constructor(
    private db: Db,
    private orchestrator: Orchestrator,
    private skillRegistry?: SkillRegistryService
  ) {
    this.conflictResolver = new ConflictResolver(db, orchestrator);
  }

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
        // Advance next_run_at only on success
        const next = new Cron(schedule.cronExpression).nextRun();
        this.db.schedules.updateAfterRun(schedule.taskId, next ? next.toISOString() : null);
        console.log(
          `  ↻ Scheduled task ${schedule.taskId} triggered, next: ${next?.toISOString() ?? "none"}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isCapacity = (err as any).capacityExceeded === true;
        if (isCapacity) {
          // Do NOT advance next_run_at — retry on next tick (1 min) when a slot frees up
          console.warn(
            `  ⏸ Schedule for task ${schedule.taskId} deferred — no agent slots available (will retry next tick)`
          );
        } else {
          // Real error: advance to avoid hammering a broken task
          const next = new Cron(schedule.cronExpression).nextRun();
          this.db.schedules.updateAfterRun(schedule.taskId, next ? next.toISOString() : null);
          console.error(`  ✗ Schedule trigger failed for task ${schedule.taskId}: ${msg}`);
        }
      }
    }

    // 2. Continuous Autonomy / Heartbeat: Sweep backlog for work stealing
    await this.orchestrator.sweepBacklog();

    // 3. Check for conflicting PRs and auto-create resolution tasks
    try {
      await this.conflictResolver.check();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Conflict resolver error: ${msg}`);
    }

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
