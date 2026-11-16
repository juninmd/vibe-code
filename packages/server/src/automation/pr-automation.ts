import type { Task } from "@vibe-code/shared";
import {
  buildCiRecoveryPrompt,
  extractGitHubCiLogs,
  parseGitHubSlug,
  pollGitHubCi,
} from "./ci-monitor";
import type { LlmFn } from "./llm";
import { type ReactionEvent, type ReactionsConfig, ReactionTracker } from "./reactions";
import {
  buildReviewFingerprint,
  buildReviewRecoveryPrompt,
  fetchPrDiff,
  fetchReviewComments,
  fetchReviewDecision,
  parsePrNumber,
} from "./review-monitor";
import {
  buildComplianceRecoveryPrompt,
  formatSpecCompliance,
  verifySpecCompliance,
} from "./spec-compliance";

export interface PrAutomationDeps {
  listReviewTasks(): Task[];
  /** Repository URL for the task (used to resolve owner/repo). */
  getRepoUrl(task: Task): string | null;
  getToken(repoUrl: string): string | null;
  isRunning(taskId: string): boolean;
  /** Re-runs the agent on the task with a recovery prompt. */
  relaunch(task: Task, prompt: string): Promise<void>;
  notify(message: string): Promise<void>;
  reactions?(task: Task): ReactionsConfig | undefined;
  fetchFn?: typeof fetch;
  llm?: LlmFn;
}

interface Seen {
  ciRun?: string;
  review?: string;
  approved?: boolean;
  specChecked?: boolean;
}

/** Watches PRs of tasks in review: CI, review feedback and spec compliance → reactions. */
export class PrAutomation {
  private timer: ReturnType<typeof setInterval> | null = null;
  private seen = new Map<string, Seen>();
  readonly tracker = new ReactionTracker();
  private busy = false;

  constructor(
    private deps: PrAutomationDeps,
    private intervalMs = 60_000
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    console.log(`  ↻ PR automation started (interval: ${this.intervalMs / 1000}s)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const live = new Set<string>();
      for (const task of this.deps.listReviewTasks()) {
        live.add(task.id);
        try {
          await this.check(task);
        } catch (err) {
          console.warn(
            `  ⚠ PR automation [${task.id}]: ${err instanceof Error ? err.message : err}`
          );
        }
      }
      for (const id of [...this.seen.keys()]) if (!live.has(id)) this.forget(id);
    } finally {
      this.busy = false;
    }
  }

  private forget(taskId: string): void {
    this.seen.delete(taskId);
    this.tracker.reset(taskId);
  }

  private async react(
    task: Task,
    event: ReactionEvent,
    prompt: string,
    label: string
  ): Promise<void> {
    const d = this.tracker.decide(task.id, event, this.deps.reactions?.(task));
    if (d.action === "skip") return;
    if (d.action === "notify") {
      const why = d.escalate ? " (retry budget exhausted — needs a human)" : "";
      await this.deps.notify(
        `${label}: "${task.title}"${why}${task.prUrl ? `\n${task.prUrl}` : ""}`
      );
      return;
    }
    await this.deps.relaunch(task, prompt);
  }

  private async check(task: Task): Promise<void> {
    const repoUrl = this.deps.getRepoUrl(task);
    if (!task.prUrl || !task.branchName || !repoUrl || this.deps.isRunning(task.id)) return;
    const token = this.deps.getToken(repoUrl);
    const slug = parseGitHubSlug(task.prUrl);
    const prNumber = parsePrNumber(task.prUrl);
    if (!token || !slug || !prNumber) return; // GitHub only for now
    const f = this.deps.fetchFn ?? fetch;
    const seen = this.seen.get(task.id) ?? {};
    this.seen.set(task.id, seen);

    // 1. Spec compliance (once per review entry)
    if (!seen.specChecked) {
      seen.specChecked = true;
      const diff = await fetchPrDiff(task.prUrl, prNumber, token, f);
      const spec = await verifySpecCompliance(task.title, task.description, diff, this.deps.llm);
      if (spec.allResults.length > 0 && !spec.success) {
        const unmet = spec.allResults.filter((r) => !r.met);
        await this.react(
          task,
          "validation_failed",
          buildComplianceRecoveryPrompt(task.title, unmet) + formatSpecCompliance(spec.allResults),
          "Spec compliance failed"
        );
        return;
      }
    }

    // 2. CI
    const ci = await pollGitHubCi(slug, task.branchName, token, f);
    if (ci?.status === "failure" && ci.id !== seen.ciRun) {
      seen.ciRun = ci.id;
      const logs = await extractGitHubCiLogs(slug, ci.id, token, f);
      await this.react(
        task,
        "ci_failed",
        buildCiRecoveryPrompt(task.title, logs, task.branchName),
        "CI failed"
      );
      return;
    }
    if (ci?.status === "success") this.tracker.reset(task.id, "ci_failed");

    // 3. Review
    const decision = await fetchReviewDecision(task.prUrl, prNumber, token, f);
    if (decision === "changes_requested") {
      const comments = await fetchReviewComments(task.prUrl, prNumber, token, f);
      const fp = buildReviewFingerprint(comments);
      if (fp && fp !== seen.review) {
        seen.review = fp;
        await this.react(
          task,
          "changes_requested",
          buildReviewRecoveryPrompt(task, comments, task.branchName),
          "Changes requested"
        );
      }
    } else if (decision === "approved" && !seen.approved) {
      seen.approved = true;
      await this.react(task, "approved", "", "PR approved");
    }
  }
}
