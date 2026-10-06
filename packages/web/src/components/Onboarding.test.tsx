import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EngineInfo } from "@vibe-code/shared";
import { describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

const engine = (name: string, available: boolean): EngineInfo => ({
  name,
  displayName: name,
  available,
  version: null,
  activeRuns: 0,
});

describe("Onboarding", () => {
  it("leads with adding a repository and offers the optional GitHub/GitLab step", async () => {
    const onAddRepo = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <Onboarding
        engines={[engine("claude-code", true)]}
        onAddRepo={onAddRepo}
        onOpenSettings={onOpenSettings}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Add repository" }));
    await userEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(onAddRepo).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("shows which agents are installed", () => {
    render(
      <Onboarding
        engines={[engine("claude-code", true), engine("opencode", false)]}
        onAddRepo={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );
    const agents = within(screen.getByRole("region", { name: "Installed agents" }));
    expect(agents.getByText(/Claude Code/)).toHaveTextContent(/\binstalled$/);
    expect(agents.getByText(/Claude Code/)).not.toHaveTextContent("not installed");
    expect(agents.getByText(/OpenCode/)).toHaveTextContent("not installed");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("warns when no agent CLI is available", () => {
    render(
      <Onboarding
        engines={[engine("claude-code", false)]}
        onAddRepo={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("Install Claude Code or OpenCode");
  });
});
