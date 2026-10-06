import {
  LANE_STATUSES,
  type LaneSettings,
  type LaneStatus,
  type Repository,
} from "@vibe-code/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

const POLL_MS = 30_000;

export interface LanesState {
  lanes: LaneSettings | null;
  refresh: () => void;
  /**
   * Label each lane stands for, given the repositories on the board: GitLab's scoped labels
   * when they are all GitLab, GitHub's otherwise. Empty while sync is off.
   */
  labelsFor: (repos: Repository[]) => Partial<Record<LaneStatus, string>>;
}

/** Lane/label sync settings and health, refreshed in the background while it is on. */
export function useLanes(): LanesState {
  const [lanes, setLanes] = useState<LaneSettings | null>(null);

  const refresh = useCallback(() => {
    api.lanes
      .get()
      .then(setLanes)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const labelsFor = useMemo(
    () =>
      (repos: Repository[]): Partial<Record<LaneStatus, string>> => {
        if (!lanes?.enabled) return {};
        const allGitLab = repos.length > 0 && repos.every((repo) => repo.provider === "gitlab");
        const defaults = lanes.defaults[allGitLab ? "gitlab" : "github"];
        return Object.fromEntries(
          LANE_STATUSES.map((lane) => [lane, lanes.overrides[lane] ?? defaults[lane]])
        );
      },
    [lanes]
  );

  return { lanes, refresh, labelsFor };
}
