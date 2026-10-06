import type { GitProvider, TaskStatus } from "./types";

/**
 * Board lanes <-> issue labels.
 *
 * A lane is a label on the issue (`status:review` on GitHub, the scoped `status::review`
 * on GitLab), so moving a card and relabelling the issue are the same action.
 */

/** Lanes that exist as labels, in the order work flows through them. */
export const LANE_STATUSES = ["backlog", "in_progress", "blocked", "review", "done"] as const;
export type LaneStatus = (typeof LANE_STATUSES)[number];
export type LaneLabelMap = Record<LaneStatus, string>;

const LANE_SLUG: Record<LaneStatus, string> = {
  backlog: "todo",
  in_progress: "in-progress",
  blocked: "blocked",
  review: "review",
  done: "done",
};

/** Hex colours (no leading #) used when vibe-code creates the labels. */
export const LANE_LABEL_COLORS: Record<LaneStatus, string> = {
  backlog: "6b7280",
  in_progress: "3b82f6",
  blocked: "ef4444",
  review: "a855f7",
  done: "22c55e",
};

export const MAX_LANE_LABEL_LENGTH = 50;

/** GitLab scoped labels (`scope::value`) are mutually exclusive, which is what a lane is. */
export function defaultLaneLabels(provider: GitProvider): LaneLabelMap {
  const prefix = provider === "gitlab" ? "status::" : "status:";
  return Object.fromEntries(
    LANE_STATUSES.map((lane) => [lane, `${prefix}${LANE_SLUG[lane]}`])
  ) as LaneLabelMap;
}

export function resolveLaneLabels(
  provider: GitProvider,
  overrides: Partial<LaneLabelMap> = {}
): LaneLabelMap {
  const labels = defaultLaneLabels(provider);
  for (const lane of LANE_STATUSES) {
    const custom = overrides[lane]?.trim();
    if (custom) labels[lane] = custom;
  }
  return labels;
}

/** The lane a task status belongs to. Scheduled and archived tasks sit outside the labels. */
export function laneOfStatus(status: TaskStatus): LaneStatus | null {
  switch (status) {
    case "backlog":
    case "in_progress":
    case "blocked":
    case "review":
    case "done":
      return status;
    case "failed":
      // A failed run needs a person, exactly like a blocked card.
      return "blocked";
    default:
      return null;
  }
}

/** Status a task takes when its issue moves to `lane`. */
export function statusOfLane(lane: LaneStatus): TaskStatus {
  return lane;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The lane an issue is in, or null when it carries none. GitHub does not keep labels
 * exclusive, so when several are present the furthest along wins (a forgotten
 * `status:todo` must not hold back a card someone moved to review).
 */
export function laneFromLabels(labels: string[], map: LaneLabelMap): LaneStatus | null {
  for (const lane of [...LANE_STATUSES].reverse()) {
    if (labels.some((label) => same(label, map[lane]))) return lane;
  }
  return null;
}

/** Like laneFromLabels, but a closed issue without a lane label counts as done. */
export function laneFromIssue(
  issue: { labels: string[]; state: "open" | "closed" },
  map: LaneLabelMap
): LaneStatus | null {
  return laneFromLabels(issue.labels, map) ?? (issue.state === "closed" ? "done" : null);
}

export interface LabelChange {
  add: string[];
  remove: string[];
}

/** What to change on an issue carrying `labels` so that it sits in `lane` and nowhere else. */
export function labelChange(labels: string[], map: LaneLabelMap, lane: LaneStatus): LabelChange {
  const target = map[lane];
  const add = labels.some((label) => same(label, target)) ? [] : [target];
  const remove = labels.filter((label) =>
    LANE_STATUSES.some((other) => other !== lane && same(label, map[other]))
  );
  return { add, remove };
}

/** An error message when the labels cannot work as lanes, otherwise null. */
export function validateLaneLabels(labels: Partial<LaneLabelMap>): string | null {
  const seen = new Map<string, LaneStatus>();
  for (const lane of LANE_STATUSES) {
    const value = labels[lane];
    if (value === undefined) continue;
    const label = value.trim();
    if (!label) continue;
    if (label.length > MAX_LANE_LABEL_LENGTH) {
      return `Label for ${lane} is longer than ${MAX_LANE_LABEL_LENGTH} characters`;
    }
    if (label.includes(",")) return `Label for ${lane} cannot contain a comma`;
    const key = label.toLowerCase();
    const clash = seen.get(key);
    if (clash) return `${clash} and ${lane} cannot use the same label`;
    seen.set(key, lane);
  }
  return null;
}

/** Issue number inside a GitHub (`/issues/12`) or GitLab (`/-/issues/12`) URL. */
export function issueNumberFromUrl(url: string | null | undefined): number | null {
  const match = url?.match(/\/issues\/(\d+)(?:[/?#]|$)/);
  return match ? Number(match[1]) : null;
}
