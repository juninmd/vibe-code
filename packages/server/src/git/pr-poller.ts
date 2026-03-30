import type { Db } from "../db";
import type { BroadcastHub } from "../ws/broadcast";

const POLL_INTERVAL_MS = 60_000; // 1 minute
const GH_API = "https://api.github.com";

export class PrPoller {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Db,
    private hub: BroadcastHub
  ) {}

  private getToken(): string | undefined {
    const dbToken = this.db.settings.get("github_token");
    if (dbToken) return dbToken;
    return process.env.GITHUB_TOKEN || undefined;
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
        const merged = await this.isPrMerged(task.prUrl);
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

  private async isPrMerged(prUrl: string): Promise<boolean> {
    // Convert https://github.com/owner/repo/pull/123 → /repos/owner/repo/pulls/123
    const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (!match) return false;

    const [, repoPath, prNumber] = match;
    const apiUrl = `${GH_API}/repos/${repoPath}/pulls/${prNumber}`;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "vibe-code",
    };
    const token = this.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(apiUrl, { headers });
    if (!res.ok) return false;
    const data = (await res.json()) as { merged: boolean; state: string };
    return data.merged === true;
  }
}
