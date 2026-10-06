import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LaneSettings } from "@vibe-code/shared";
import { describe, expect, it, vi } from "vitest";
import { LaneSyncPill } from "./LaneSyncPill";

const base: LaneSettings = {
  enabled: true,
  overrides: {},
  defaults: {} as LaneSettings["defaults"],
  status: { running: false, lastSyncAt: new Date().toISOString(), repos: [] },
};

describe("LaneSyncPill", () => {
  it("is invisible while the sync is off or not loaded", () => {
    const { container, rerender } = render(<LaneSyncPill lanes={null} onClick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<LaneSyncPill lanes={{ ...base, enabled: false }} onClick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says when the labels were last synced and opens the lane settings", async () => {
    const onClick = vi.fn();
    render(<LaneSyncPill lanes={base} onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: /labels synced just now/i }));
    expect(onClick).toHaveBeenCalled();
  });

  it("flags repositories that cannot sync and lists why on hover", () => {
    const lanes: LaneSettings = {
      ...base,
      status: {
        running: false,
        lastSyncAt: null,
        repos: [
          {
            repoId: "1",
            name: "o/a",
            ok: false,
            error: "403",
            linked: 0,
            pulled: 0,
            pushed: 0,
            imported: 0,
          },
          { repoId: "2", name: "o/b", ok: true, linked: 1, pulled: 0, pushed: 0, imported: 0 },
        ],
      },
    };
    render(<LaneSyncPill lanes={lanes} onClick={vi.fn()} />);
    const pill = screen.getByRole("button", { name: "1 repo not syncing" });
    expect(pill).toHaveAttribute("title", "o/a: 403");
  });

  it("shows progress while a sync runs", () => {
    render(
      <LaneSyncPill
        lanes={{ ...base, status: { ...base.status, running: true } }}
        onClick={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Syncing labels..." })).toBeInTheDocument();
  });
});
