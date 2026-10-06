import type { LaneSettings } from "@vibe-code/shared";
import { ago } from "./lane-utils";

interface LaneSyncPillProps {
  lanes: LaneSettings | null;
  onClick: () => void;
}

/** Header status of the lane/label sync; nothing at all while the sync is off. */
export function LaneSyncPill({ lanes, onClick }: LaneSyncPillProps) {
  if (!lanes?.enabled) return null;
  const failing = lanes.status.repos.filter((repo) => !repo.ok);
  const syncing = lanes.status.running;
  const label = failing.length
    ? `${failing.length} repo${failing.length > 1 ? "s" : ""} not syncing`
    : syncing
      ? "Syncing labels..."
      : `Labels synced ${ago(lanes.status.lastSyncAt)}`;
  const dot = failing.length ? "bg-danger" : syncing ? "bg-accent animate-pulse" : "bg-success";

  return (
    <button
      type="button"
      onClick={onClick}
      title={
        failing.length
          ? failing.map((repo) => `${repo.name}: ${repo.error}`).join("\n")
          : "Board lanes follow the labels of the linked issues"
      }
      className="hidden items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover lg:inline-flex"
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </button>
  );
}
