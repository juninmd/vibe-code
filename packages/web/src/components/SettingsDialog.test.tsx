import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: {
    settings: { get: vi.fn(), update: vi.fn(), testConnection: vi.fn() },
    auth: { me: vi.fn(), loginUrl: () => "/api/auth/github/start" },
  },
}));

vi.mock("../api/client", () => ({ api }));

import { SettingsDialog } from "./SettingsDialog";

const settings = (githubTokenSet: boolean) => ({
  github: { token: githubTokenSet ? "••••" : "", tokenSet: githubTokenSet },
  gitlab: { token: "", tokenSet: false, baseUrl: "https://gitlab.com" },
  litellm: { baseUrl: "http://localhost:4000", enabled: false },
  apiKeys: {},
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SettingsDialog GitHub tab", () => {
  it("lets you connect with a token when OAuth login is not configured", async () => {
    api.settings.get.mockResolvedValue(settings(false));
    api.auth.me.mockResolvedValue({ enabled: false, authenticated: true, user: null });
    render(<SettingsDialog open onClose={vi.fn()} />);

    expect(await screen.findByPlaceholderText("ghp_xxxxxxxxxxxx")).toBeInTheDocument();
    await waitFor(() => expect(api.auth.me).toHaveBeenCalled());
    expect(screen.queryByText(/Login with GitHub/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Missing Server Config/)).not.toBeInTheDocument();
  });

  it("never renders '@undefined' for a token whose owner is unknown", async () => {
    api.settings.get.mockResolvedValue(settings(true));
    api.auth.me.mockResolvedValue({ enabled: false, authenticated: true, user: null });
    render(<SettingsDialog open onClose={vi.fn()} />);

    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it("offers GitHub login only when the server supports it", async () => {
    api.settings.get.mockResolvedValue(settings(false));
    api.auth.me.mockResolvedValue({ enabled: true, authenticated: true, user: null });
    render(<SettingsDialog open onClose={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Login with GitHub" })).toBeEnabled();
    expect(screen.getByText("Not signed in")).toBeInTheDocument();
  });

  it("is simply called Settings", async () => {
    api.settings.get.mockResolvedValue(settings(false));
    api.auth.me.mockResolvedValue({ enabled: false, authenticated: true, user: null });
    render(<SettingsDialog open onClose={vi.fn()} />);
    expect(await screen.findByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("System Configuration")).not.toBeInTheDocument();
  });
});
