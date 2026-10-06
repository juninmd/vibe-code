import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api, ApiErrorRef } = vi.hoisted(() => ({
  api: {
    repos: {
      listGitHub: vi.fn(),
      listGitLab: vi.fn(),
      searchGitHub: vi.fn(),
      searchGitLab: vi.fn(),
      createGitHub: vi.fn(),
      createGitLab: vi.fn(),
    },
  },
  ApiErrorRef: {
    current: class extends Error {
      status: number;
      constructor(message: string, status: number) {
        super(message);
        this.status = status;
      }
    },
  },
}));

vi.mock("../api/client", () => ({ api, ApiError: ApiErrorRef.current }));

import { AddRepoDialog } from "./AddRepoDialog";

const noop = async () => {};

beforeEach(() => {
  vi.clearAllMocks();
  api.repos.listGitHub.mockResolvedValue([]);
  api.repos.listGitLab.mockResolvedValue([]);
});

describe("AddRepoDialog", () => {
  it("does not call the provider while it is closed", async () => {
    render(<AddRepoDialog open={false} onClose={vi.fn()} onSubmit={noop} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.repos.listGitHub).not.toHaveBeenCalled();
    expect(api.repos.searchGitHub).not.toHaveBeenCalled();
  });

  it("loads the recent repositories exactly once when it opens", async () => {
    render(<AddRepoDialog open onClose={vi.fn()} onSubmit={noop} />);
    await waitFor(() => expect(api.repos.listGitHub).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.repos.listGitHub).toHaveBeenCalledTimes(1);
  });

  it("turns a missing token into a setup step with a way forward", async () => {
    const ApiError = ApiErrorRef.current;
    api.repos.listGitHub.mockRejectedValue(
      new ApiError("GitHub is not connected. Add an access token in Settings → GitHub.", 409)
    );
    const onOpenSettings = vi.fn();
    const onClose = vi.fn();
    render(
      <AddRepoDialog open onClose={onClose} onSubmit={noop} onOpenSettings={onOpenSettings} />
    );

    expect(await screen.findByText("Connect GitHub")).toBeInTheDocument();
    expect(screen.getByText(/Add an access token in Settings/)).toBeInTheDocument();
    expect(screen.queryByText("Could not load repositories")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps real failures distinguishable from a missing connection", async () => {
    const ApiError = ApiErrorRef.current;
    api.repos.listGitHub.mockRejectedValue(new ApiError("Bad credentials", 500));
    render(<AddRepoDialog open onClose={vi.fn()} onSubmit={noop} onOpenSettings={vi.fn()} />);

    expect(await screen.findByText("Could not load repositories")).toBeInTheDocument();
    expect(screen.getByText("Bad credentials")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open settings" })).not.toBeInTheDocument();
  });
});
