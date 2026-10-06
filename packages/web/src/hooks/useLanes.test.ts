import { renderHook, waitFor } from "@testing-library/react";
import type { LaneSettings, Repository } from "@vibe-code/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({ api: { lanes: { get: vi.fn() } } }));
vi.mock("../api/client", () => ({ api }));

import { useLanes } from "./useLanes";

const settings = (over: Partial<LaneSettings> = {}): LaneSettings => ({
  enabled: true,
  overrides: {},
  defaults: {
    github: {
      backlog: "status:todo",
      in_progress: "status:in-progress",
      blocked: "status:blocked",
      review: "status:review",
      done: "status:done",
    },
    gitlab: {
      backlog: "status::todo",
      in_progress: "status::in-progress",
      blocked: "status::blocked",
      review: "status::review",
      done: "status::done",
    },
  },
  status: { running: false, lastSyncAt: null, repos: [] },
  ...over,
});

const repo = (provider: "github" | "gitlab") => ({ provider }) as Repository;

beforeEach(() => vi.clearAllMocks());

describe("useLanes", () => {
  it("knows each lane's label per provider, with the operator's overrides on top", async () => {
    api.lanes.get.mockResolvedValue(settings({ overrides: { review: "In QA" } }));
    const { result } = renderHook(() => useLanes());
    await waitFor(() => expect(result.current.lanes?.enabled).toBe(true));

    expect(result.current.labelsFor([repo("github")])).toMatchObject({
      backlog: "status:todo",
      review: "In QA",
    });
    expect(result.current.labelsFor([repo("gitlab")])).toMatchObject({
      backlog: "status::todo",
      review: "In QA",
    });
    // A board mixing providers shows GitHub's names; GitLab-only boards show GitLab's.
    expect(result.current.labelsFor([repo("gitlab"), repo("github")]).done).toBe("status:done");
    expect(result.current.labelsFor([repo("gitlab"), repo("gitlab")]).done).toBe("status::done");
    expect(result.current.labelsFor([]).done).toBe("status:done");
  });

  it("shows no labels while the sync is off", async () => {
    api.lanes.get.mockResolvedValue(settings({ enabled: false }));
    const { result } = renderHook(() => useLanes());
    await waitFor(() => expect(result.current.lanes).not.toBeNull());
    expect(result.current.labelsFor([repo("github")])).toEqual({});
  });

  it("copes with the server being unreachable", async () => {
    api.lanes.get.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useLanes());
    await waitFor(() => expect(api.lanes.get).toHaveBeenCalled());
    expect(result.current.lanes).toBeNull();
    expect(result.current.labelsFor([])).toEqual({});
  });
});
