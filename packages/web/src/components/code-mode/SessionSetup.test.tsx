import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { EngineInfo, Repository } from "@vibe-code/shared";
import { describe, expect, it, vi } from "vitest";
import { SessionSetup } from "./SessionSetup";

vi.mock("../../api/client", () => ({
  api: {
    engines: { models: vi.fn().mockResolvedValue([]) },
    repos: { branches: vi.fn().mockResolvedValue([]) },
  },
}));

const ENGINES: EngineInfo[] = [
  {
    name: "opencode",
    displayName: "OpenCode",
    available: true,
    version: "1.0.0",
    activeRuns: 0,
    supportsResume: true,
  },
  {
    name: "claude-code",
    displayName: "Claude Code",
    available: true,
    version: "1.0.0",
    activeRuns: 0,
    supportsResume: false,
  },
];

const REPOS = [
  {
    id: "repo-1",
    name: "fixture-repo",
    url: "https://github.com/example/fixture-repo.git",
    status: "ready",
    defaultBranch: "main",
  },
] as unknown as Repository[];

function renderSetup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SessionSetup
        repos={REPOS}
        engines={ENGINES}
        value={{ repoId: "repo-1", engine: "opencode", model: "", baseBranch: "main" }}
        onChange={() => {}}
      />
    </QueryClientProvider>
  );
}

describe("SessionSetup", () => {
  it("only offers engines that can resume the conversation", () => {
    renderSetup();
    const select = screen.getByLabelText("Agent engine") as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);

    expect(values).toContain("opencode");
    expect(values).not.toContain("claude-code");
  });
});
