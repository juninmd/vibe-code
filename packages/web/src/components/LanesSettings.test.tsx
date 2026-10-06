import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LaneSettings } from "@vibe-code/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: { lanes: { get: vi.fn(), update: vi.fn(), sync: vi.fn() } },
}));
vi.mock("../api/client", () => ({ api }));

import { LanesSettings } from "./LanesSettings";

const defaults: LaneSettings["defaults"] = {
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
};

const off: LaneSettings = {
  enabled: false,
  overrides: {},
  defaults,
  status: { running: false, lastSyncAt: null, repos: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.lanes.get.mockResolvedValue(off);
});

describe("LanesSettings", () => {
  it("explains the sync and starts switched off with the provider defaults as hints", async () => {
    render(<LanesSettings />);
    const toggle = await screen.findByRole("switch", { name: /sync lanes/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Review")).toHaveAttribute("placeholder", "status:review");
    expect(screen.getByText("GitLab default: status::review")).toBeInTheDocument();
    expect(screen.getByText(/never starts an agent/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sync now/i })).not.toBeInTheDocument();
  });

  it("turns the sync on and shows how each repository is doing", async () => {
    api.lanes.update.mockResolvedValue({
      ...off,
      enabled: true,
      status: {
        running: false,
        lastSyncAt: new Date().toISOString(),
        repos: [
          { repoId: "1", name: "o/ok", ok: true, linked: 3, pulled: 1, pushed: 2, imported: 1 },
          {
            repoId: "2",
            name: "o/bad",
            ok: false,
            error: "Add a GitHub token in Settings",
            linked: 0,
            pulled: 0,
            pushed: 0,
            imported: 0,
          },
        ],
      },
    });
    render(<LanesSettings />);
    await userEvent.click(await screen.findByRole("switch", { name: /sync lanes/i }));

    await waitFor(() => expect(api.lanes.update).toHaveBeenCalledWith({ enabled: true }));
    expect(
      await screen.findByText("3 linked · 2 pushed · 1 pulled · 1 imported")
    ).toBeInTheDocument();
    expect(screen.getByText("Add a GitHub token in Settings")).toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /sync lanes/i })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("saves customised labels and can discard edits", async () => {
    api.lanes.update.mockResolvedValue({ ...off, overrides: { review: "In QA" } });
    render(<LanesSettings />);
    const review = await screen.findByLabelText("Review");
    const save = screen.getByRole("button", { name: "Save labels" });
    expect(save).toBeDisabled();

    await userEvent.type(review, "In QA");
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() =>
      expect(api.lanes.update).toHaveBeenCalledWith({ labels: { review: "In QA" } })
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Save labels" })).toBeDisabled());

    await userEvent.type(review, "x");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(review).toHaveValue("In QA");
  });

  it("shows the server's reason when labels are rejected", async () => {
    api.lanes.update.mockRejectedValue(new Error("review and done cannot use the same label"));
    render(<LanesSettings />);
    await userEvent.type(await screen.findByLabelText("Review"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save labels" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot use the same label");
  });

  it("syncs on demand", async () => {
    api.lanes.get.mockResolvedValue({ ...off, enabled: true });
    api.lanes.sync.mockResolvedValue({
      ...off,
      enabled: true,
      status: { running: false, lastSyncAt: new Date().toISOString(), repos: [] },
    });
    render(<LanesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(api.lanes.sync).toHaveBeenCalled());
    expect(await screen.findByText("just now")).toBeInTheDocument();
  });

  it("reports a failure to load", async () => {
    api.lanes.get.mockRejectedValue(new Error("offline"));
    render(<LanesSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(within(document.body).queryByRole("switch")).not.toBeInTheDocument();
  });
});
