import type { Db } from "../db";
import type { BroadcastHub } from "../ws/broadcast";
import type { ProviderRegistry } from "./providers/registry";

const POLL_INTERVAL_MS = 60_000; // 1 minute

export class PrPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private providerRegistry: ProviderRegistry | null = null;

  constructor(
    private db: Db,
    private hub: BroadcastHub
  ) {}

  setProviderRegistry(registry: ProviderRegistry): void {
    this.providerRegistry = registry;
  }

  start(): void {
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    console.log("  ↻ PR poller started (interval: 60s)");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    const tasks = this.db.tasks.list().filter((t) => t.status === "review" && t.prUrl);
    if (tasks.length === 0) return;

    for (const task of tasks) {
      try {
        if (!task.prUrl) continue;
        const merged = await this.checkMerged(task.prUrl);
        if (merged) {
          const updated = this.db.tasks.update(task.id, { status: "done" });
          if (updated) {
            this.hub.broadcastAll({ type: "task_updated", task: updated });
            console.log(`  ✓ PR merged → task "${task.title}" moved to done`);
          }
        }
      } catch {
        // Ignore individual errors (rate limits, network, etc.)
      }
    }
  }

  private async checkMerged(prUrl: string): Promise<boolean> {
    if (!this.providerRegistry) return false;
    const resolved = this.providerRegistry.resolve(prUrl);
    if (!resolved) return false;
    try {
      return await resolved.adapter.isPrMerged(resolved.token, prUrl);
    } catch {
      return false;
    }
  }
}
