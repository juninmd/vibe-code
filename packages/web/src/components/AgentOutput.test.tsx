import { render, screen } from "@testing-library/react";
import type { AgentLog } from "@vibe-code/shared";
import { describe, expect, it, vi } from "vitest";
import { AgentOutput } from "./AgentOutput";

vi.mock("../api/client", () => ({
  api: {
    runs: {
      logs: vi.fn().mockResolvedValue([]),
    },
  },
}));

const logs: AgentLog[] = [
  {
    id: 1,
    runId: "run-1",
    stream: "stdout",
    content: "opencode raw line\nwith wrapped command output",
    timestamp: new Date().toISOString(),
  },
];

describe("AgentOutput", () => {
  it("defaults full-height execution output to raw readable logs", () => {
    render(
      <AgentOutput runId="run-1" liveLogs={logs} isRunning onSendInput={vi.fn()} fullHeight />
    );

    expect(screen.getByRole("button", { name: "Raw" })).toHaveClass("text-primary");
    expect(screen.getByText(/opencode raw line/)).toBeInTheDocument();
  });
});
