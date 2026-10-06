import {
  defaultLaneLabels,
  issueNumberFromUrl,
  LANE_LABEL_COLORS,
  LANE_STATUSES,
  type LaneLabelMap,
  type LaneSettings,
  type LaneStatus,
  type LaneSyncRepoStatus,
  type LaneSyncStatus,
  labelChange,
  laneFromIssue,
  laneFromLabels,
  laneOfStatus,
  MANUAL_TASK_TAG,
  type Repository,
  type RepositoryIssue,
  resolveLaneLabels,
  statusOfLane,
  type Task,
  type UpdateLaneSettingsRequest,
  validateLaneLabels,
} from "@vibe-code/shared";
import type { Db } from "../db";
import type { ProviderRegistry } from "../git/providers/registry";
import type { BroadcastHub } from "../ws/broadcast";

/**
 * Keeps the board's lanes and the labels of the linked GitHub/GitLab issues in step.
 *
 * Moving a card relabels its issue; relabelling the issue moves the card. The issue is the
 * source of truth: when both sides changed since they last agreed, the issue wins (unless
 * an agent is working on the card, or the operator just moved it). Nothing here ever
 * starts an agent — lanes only organise work.
 */

const ENABLED_KEY = "lane_sync_enabled";
const LABELS_KEY = "lane_labels";
const IGNORED_KEY = "lane_ignored_issues";

const DEFAULT_POLL_MS = 60_000;
const DEFAULT_DEBOUNCE_MS = 1_500;
const ERROR_COOLDOWN_MS = 5 * 60_000;
/** Issues fetched per repository and run: the most recently updated ones. */
const ISSUE_WINDOW = 100;
const MAX_IMPORT_PER_RUN = 20;
const MAX_IGNORED_PER_REPO = 500;

export class LaneConfigError extends Error {}

export type LaneAction =
  | { kind: "none" }
  /** Task and issue already agree; just remember it. */
  | { kind: "settle"; lane: LaneStatus }
  /** The card moved: relabel the issue. */
  | { kind: "push"; lane: LaneStatus }
  /** The issue moved: move the card. */
  | { kind: "pull"; lane: LaneStatus };

export interface LaneFacts {
  /** Lane of the card now. */
  local: LaneStatus | null;
  /** Lane both sides agreed on last time; null before the first sync. */
  synced: LaneStatus | null;
  /** Lane of the issue now; null when it carries none. */
  remote: LaneStatus | null;
  /** An agent is working on the card. */
  busy: boolean;
  /** The operator moved the card since the last sync. */
  preferLocal: boolean;
}

/** The whole conflict policy, kept pure so it can be tested to the letter. */
export function decideLaneSync(facts: LaneFacts): LaneAction {
  const { local, synced, remote, busy, preferLocal } = facts;
  if (!local) return { kind: "none" };

  if (!synced) {
    if (!remote) return { kind: "push", lane: local };
    if (remote === local) return { kind: "settle", lane: local };
    return busy ? { kind: "push", lane: local } : { kind: "pull", lane: remote };
  }

  // Someone stripped the labels: put the card's lane back.
  if (!remote) return { kind: "push", lane: local };

  if (remote === local)
    return remote === synced ? { kind: "none" } : { kind: "settle", lane: local };
  const localChanged = local !== synced;
  const remoteChanged = remote !== synced;
  if (remoteChanged && localChanged) {
    return busy || preferLocal ? { kind: "push", lane: local } : { kind: "pull", lane: remote };
  }
  if (remoteChanged) return busy ? { kind: "none" } : { kind: "pull", lane: remote };
  // Only the card moved.
  return { kind: "push", lane: local };
}

export interface LaneSyncDeps {
  db: Db;
  providers: ProviderRegistry;
  hub: BroadcastHub;
  /** True while an agent (terminal or headless run) is working on the task. */
  isBusy: (taskId: string) => boolean;
  pollMs?: number;
  debounceMs?: number;
}

function parseOverrides(raw: string | null | undefined): Partial<LaneLabelMap> {
  try {
    const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
    const overrides: Partial<LaneLabelMap> = {};
    for (const lane of LANE_STATUSES) {
      const value = parsed[lane];
      if (typeof value === "string" && value.trim()) overrides[lane] = value.trim();
    }
    return overrides;
  } catch {
    return {};
  }
}

export class LaneSyncService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly debounce = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly preferLocal = new Set<string>();
  private readonly cooldown = new Map<string, number>();
  private readonly ensured = new Set<string>();
  private readonly repoStatus = new Map<string, LaneSyncRepoStatus>();
  private queue: Promise<unknown> = Promise.resolve();
  private running = 0;
  private lastSyncAt: string | null = null;
  /** True while this service itself writes tasks, so those writes are not re-synced. */
  private applying = false;

  constructor(private readonly deps: LaneSyncDeps) {}

  // ─── Configuration ────────────────────────────────────────────────────────

  get enabled(): boolean {
    return this.deps.db.settings.get(ENABLED_KEY) === "true";
  }

  private overrides(): Partial<LaneLabelMap> {
    return parseOverrides(this.deps.db.settings.get(LABELS_KEY));
  }

  settings(): LaneSettings {
    return {
      enabled: this.enabled,
      overrides: this.overrides(),
      defaults: { github: defaultLaneLabels("github"), gitlab: defaultLaneLabels("gitlab") },
      status: this.status(),
    };
  }

  update(patch: UpdateLaneSettingsRequest): LaneSettings {
    const { settings } = this.deps.db;
    if (patch.labels) {
      const error = validateLaneLabels(patch.labels);
      if (error) throw new LaneConfigError(error);
      settings.set(LABELS_KEY, JSON.stringify(parseOverrides(JSON.stringify(patch.labels))));
      this.ensured.clear();
    }
    if (patch.enabled !== undefined) {
      settings.set(ENABLED_KEY, patch.enabled ? "true" : "false");
      if (!patch.enabled) this.cancelPending();
    }
    if (this.enabled && (patch.enabled || patch.labels)) void this.syncAll().catch(() => {});
    return this.settings();
  }

  /** Lane an issue with these labels sits in, or null when sync is off or it has none. */
  laneForLabels(repo: Repository, labels: string[]): LaneStatus | null {
    if (!this.enabled) return null;
    const provider = this.deps.providers.detectProvider(repo.url);
    return laneFromLabels(labels, resolveLaneLabels(provider, this.overrides()));
  }

  status(): LaneSyncStatus {
    return {
      running: this.running > 0,
      lastSyncAt: this.lastSyncAt,
      repos: [...this.repoStatus.values()],
    };
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  start(): void {
    if (this.timer) return;
    this.unsubscribe = this.deps.db.tasks.subscribe((task) => this.nudge(task));
    this.timer = setInterval(() => {
      if (this.enabled) void this.syncAll().catch(() => {});
    }, this.deps.pollMs ?? DEFAULT_POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.cancelPending();
  }

  private cancelPending(): void {
    for (const timer of this.debounce.values()) clearTimeout(timer);
    this.debounce.clear();
    this.preferLocal.clear();
  }

  /** A linked card changed: if it left its issue's lane, sync that repository soon. */
  nudge(task: Task): void {
    if (this.applying || !this.enabled || !task.issueUrl) return;
    const lane = laneOfStatus(task.status);
    if (!lane || lane === task.issueLane) return;

    this.preferLocal.add(task.id);
    const pending = this.debounce.get(task.repoId);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => {
      this.debounce.delete(task.repoId);
      const repo = this.deps.db.repos.getById(task.repoId);
      if (repo) void this.enqueue(() => this.syncRepo(repo)).catch(() => {});
    }, this.deps.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    timer.unref?.();
    this.debounce.set(task.repoId, timer);
  }

  // ─── Running a sync ───────────────────────────────────────────────────────

  /** Syncs run one at a time: a poll and a nudge must not race on the same issues. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      this.running++;
      try {
        return await job();
      } finally {
        this.running--;
      }
    });
    this.queue = next.catch(() => {});
    return next;
  }

  async syncAll(): Promise<LaneSyncStatus> {
    await this.enqueue(async () => {
      for (const repo of this.deps.db.repos.list()) {
        if (this.deps.providers.detectProvider(repo.url) === "manual") continue;
        await this.syncRepo(repo);
      }
      this.lastSyncAt = new Date().toISOString();
    });
    return this.status();
  }

  async syncRepo(repo: Repository): Promise<LaneSyncRepoStatus> {
    const result: LaneSyncRepoStatus = {
      repoId: repo.id,
      name: repo.name,
      ok: true,
      linked: 0,
      pulled: 0,
      pushed: 0,
      imported: 0,
    };
    this.repoStatus.set(repo.id, result);

    if ((this.cooldown.get(repo.id) ?? 0) > Date.now()) {
      result.ok = false;
      result.error = "Paused after an error; retrying shortly";
      return result;
    }

    try {
      const resolved = this.deps.providers.resolve(repo.url);
      if (!resolved) {
        result.ok = false;
        result.error = `Add a ${repo.provider === "gitlab" ? "GitLab" : "GitHub"} token in Settings`;
        return result;
      }
      await this.run(repo, resolved, result);
      this.cooldown.delete(repo.id);
    } catch (error) {
      result.ok = false;
      result.error = error instanceof Error ? error.message : String(error);
      this.cooldown.set(repo.id, Date.now() + ERROR_COOLDOWN_MS);
      console.warn("[lanes] WARN: lane sync failed", { repo: repo.name, error: result.error });
    }
    return result;
  }

  private async run(
    repo: Repository,
    resolved: NonNullable<ReturnType<ProviderRegistry["resolve"]>>,
    result: LaneSyncRepoStatus
  ): Promise<void> {
    const { db, isBusy } = this.deps;
    const { adapter, token, provider } = resolved;
    const map = resolveLaneLabels(provider, this.overrides());

    const issues = await adapter.listIssues(token, repo.url, {
      state: "all",
      limit: ISSUE_WINDOW,
      recentlyUpdated: true,
    });
    const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
    await this.ensureLabels(repo, resolved, map);

    const tasks = db.tasks.list(repo.id);
    const linkedNumbers = new Set<number>();
    for (const task of tasks) {
      const number = issueNumberFromUrl(task.issueUrl);
      if (number !== null) linkedNumbers.add(number);
    }

    for (const task of tasks) {
      const number = issueNumberFromUrl(task.issueUrl);
      if (number === null || task.status === "archived") continue;
      result.linked++;

      const issue = byNumber.get(number);
      const local = laneOfStatus(task.status);
      const synced = (task.issueLane as LaneStatus | null | undefined) ?? null;
      // An issue outside the fetched window did not change: treat it as agreeing.
      const remote = issue ? laneFromIssue(issue, map) : synced;
      const action = decideLaneSync({
        local,
        synced: LANE_STATUSES.includes(synced as LaneStatus) ? synced : null,
        remote,
        busy: isBusy(task.id),
        preferLocal: this.preferLocal.has(task.id),
      });

      try {
        if (action.kind === "settle") {
          db.tasks.setIssueLane(task.id, action.lane);
        } else if (action.kind === "push") {
          await adapter.updateIssueLabels(
            token,
            repo.url,
            number,
            labelChange(issue?.labels ?? [], map, action.lane)
          );
          db.tasks.setIssueLane(task.id, action.lane);
          result.pushed++;
        } else if (action.kind === "pull") {
          this.moveCard(task, action.lane);
          result.pulled++;
        }
      } catch (error) {
        // One bad issue must not stall the others; it is retried on the next run.
        result.ok = false;
        result.error = error instanceof Error ? error.message : String(error);
      }
      this.preferLocal.delete(task.id);
    }

    result.imported = this.importIssues(repo, issues, linkedNumbers, map);
  }

  /** Move a card because its issue moved. */
  private moveCard(task: Task, lane: LaneStatus): void {
    this.applying = true;
    try {
      const updated = this.deps.db.tasks.updateField(task.id, "status", statusOfLane(lane));
      this.deps.db.tasks.setIssueLane(task.id, lane);
      if (updated) {
        this.deps.hub.broadcastAll({
          type: "task_updated",
          task: { ...updated, issueLane: lane },
        });
      }
    } finally {
      this.applying = false;
    }
  }

  /** Issues that carry a lane label belong on the board. */
  private importIssues(
    repo: Repository,
    issues: RepositoryIssue[],
    linked: Set<number>,
    map: LaneLabelMap
  ): number {
    const { db, hub } = this.deps;
    const ignored = new Set(this.ignoredFor(repo.id));
    const laneLabels = new Set(LANE_STATUSES.map((lane) => map[lane].toLowerCase()));
    let imported = 0;

    for (const issue of issues) {
      if (imported >= MAX_IMPORT_PER_RUN) break;
      if (issue.state !== "open" || linked.has(issue.number) || ignored.has(issue.number)) continue;
      const lane = laneFromLabels(issue.labels, map);
      if (!lane) continue;

      const tags = issue.labels.filter((label) => !laneLabels.has(label.toLowerCase()));
      this.applying = true;
      try {
        const task = db.tasks.create({
          title: issue.title,
          description: [issue.body ?? "", "", "---", `Original issue: ${issue.url}`]
            .filter(Boolean)
            .join("\n"),
          repoId: repo.id,
          // Cards that appear because someone labelled an issue are never run by the autopilot.
          tags: [MANUAL_TASK_TAG, ...tags],
          issueUrl: issue.url,
          status: statusOfLane(lane),
        });
        db.tasks.setIssueLane(task.id, lane);
        hub.broadcastAll({ type: "task_created", task: { ...task, issueLane: lane } });
        imported++;
      } finally {
        this.applying = false;
      }
    }
    return imported;
  }

  /** Create the lane labels (with colours) so they are ready to pick on the provider. */
  private async ensureLabels(
    repo: Repository,
    resolved: NonNullable<ReturnType<ProviderRegistry["resolve"]>>,
    map: LaneLabelMap
  ): Promise<void> {
    const key = `${repo.id}:${LANE_STATUSES.map((lane) => map[lane]).join("|")}`;
    if (this.ensured.has(key)) return;
    try {
      await resolved.adapter.ensureLabels(
        resolved.token,
        repo.url,
        LANE_STATUSES.map((lane) => ({
          name: map[lane],
          color: LANE_LABEL_COLORS[lane],
          description: "Board lane managed by vibe-code",
        }))
      );
      this.ensured.add(key);
    } catch {
      // Cosmetic: adding a label to an issue creates it anyway.
    }
  }

  // ─── Deleted cards ────────────────────────────────────────────────────────

  private ignoredFor(repoId: string): number[] {
    try {
      const all = JSON.parse(this.deps.db.settings.get(IGNORED_KEY) || "{}") as Record<
        string,
        number[]
      >;
      return Array.isArray(all[repoId]) ? all[repoId] : [];
    } catch {
      return [];
    }
  }

  /**
   * A card was deleted on purpose: stop importing its issue and take it off the lanes on
   * the provider, otherwise the next sync would bring it back.
   */
  async forget(task: Task): Promise<void> {
    const number = issueNumberFromUrl(task.issueUrl);
    if (number === null || !this.enabled) return;
    const { db } = this.deps;

    try {
      const all = JSON.parse(db.settings.get(IGNORED_KEY) || "{}") as Record<string, number[]>;
      const known = Array.isArray(all[task.repoId]) ? all[task.repoId] : [];
      all[task.repoId] = [...new Set([...known, number])].slice(-MAX_IGNORED_PER_REPO);
      db.settings.set(IGNORED_KEY, JSON.stringify(all));
    } catch {
      // Best effort.
    }

    const repo = db.repos.getById(task.repoId);
    const resolved = repo ? this.deps.providers.resolve(repo.url) : null;
    if (!repo || !resolved) return;
    const map = resolveLaneLabels(resolved.provider, this.overrides());
    try {
      await resolved.adapter.updateIssueLabels(resolved.token, repo.url, number, {
        add: [],
        remove: LANE_STATUSES.map((lane) => map[lane]),
      });
    } catch {
      // The issue keeps its label; it is ignored locally all the same.
    }
  }
}
