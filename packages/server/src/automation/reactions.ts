/** Reaction policy: what to do when a PR/run event happens (CI failed, changes requested, …). */
export type ReactionEvent =
  | "ci_failed"
  | "changes_requested"
  | "approved"
  | "agent_stuck"
  | "validation_failed";
export type ReactionAction = "reinvoke" | "notify" | "skip";

export interface ReactionConfig {
  action: ReactionAction;
  max_retries?: number;
  escalate_after?: string;
}

export type ReactionsConfig = Partial<Record<ReactionEvent, ReactionConfig>>;

export const DEFAULT_REACTIONS: Record<ReactionEvent, ReactionConfig> = {
  ci_failed: { action: "reinvoke", max_retries: 3, escalate_after: "30m" },
  changes_requested: { action: "reinvoke", max_retries: 2, escalate_after: "1h" },
  approved: { action: "notify" },
  agent_stuck: { action: "notify" },
  validation_failed: { action: "reinvoke", max_retries: 2 },
};

/** Parses "30m", "1h" or "90s" into milliseconds; null when invalid. */
export function parseDuration(duration: string | undefined): number | null {
  if (!duration) return null;
  const match = duration.match(/^(\d+)(s|m|h)$/);
  if (!match) return null;
  const value = Number.parseInt(match[1] as string, 10);
  const unit = { s: 1000, m: 60_000, h: 3_600_000 }[match[2] as "s" | "m" | "h"];
  return value * unit;
}

export function resolveReaction(
  event: ReactionEvent,
  userReactions: ReactionsConfig | undefined
): ReactionConfig {
  return { ...DEFAULT_REACTIONS[event], ...userReactions?.[event] };
}

/** True once the retry budget or the escalation window is exhausted. */
export function shouldEscalate(
  reaction: ReactionConfig,
  attempts: number,
  firstTriggeredAt: number,
  now = Date.now()
): boolean {
  if (reaction.max_retries !== undefined && attempts >= reaction.max_retries) return true;
  const durationMs = parseDuration(reaction.escalate_after);
  return durationMs !== null && now - firstTriggeredAt >= durationMs;
}

interface Tracker {
  attempts: number;
  firstAt: number;
}

/** Tracks attempts per (task, event) and decides the next step. */
export class ReactionTracker {
  private state = new Map<string, Tracker>();

  decide(
    taskId: string,
    event: ReactionEvent,
    userReactions?: ReactionsConfig,
    now = Date.now()
  ): { action: ReactionAction; escalate: boolean; attempt: number } {
    const reaction = resolveReaction(event, userReactions);
    const key = `${taskId}:${event}`;
    const cur = this.state.get(key) ?? { attempts: 0, firstAt: now };
    if (
      reaction.action === "reinvoke" &&
      shouldEscalate(reaction, cur.attempts, cur.firstAt, now)
    ) {
      return { action: "notify", escalate: true, attempt: cur.attempts };
    }
    if (reaction.action === "reinvoke") {
      cur.attempts += 1;
      this.state.set(key, cur);
    }
    return { action: reaction.action, escalate: false, attempt: cur.attempts };
  }

  reset(taskId: string, event?: ReactionEvent): void {
    for (const k of [...this.state.keys()]) {
      if (k.startsWith(`${taskId}:`) && (!event || k === `${taskId}:${event}`))
        this.state.delete(k);
    }
  }
}
