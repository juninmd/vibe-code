import { describe, expect, it } from "vitest";
import { getPhaseLabel, RUN_PHASE_LABELS } from "./runPhase";

describe("getPhaseLabel", () => {
  it("returns 'Running...' for falsy values", () => {
    expect(getPhaseLabel("")).toBe("Running...");
    expect(getPhaseLabel(null)).toBe("Running...");
    expect(getPhaseLabel(undefined)).toBe("Running...");
  });

  it("returns the label for known phases", () => {
    expect(getPhaseLabel("setup")).toBe(RUN_PHASE_LABELS.setup);
    expect(getPhaseLabel("worktree_ready")).toBe(RUN_PHASE_LABELS.worktree_ready);
    expect(getPhaseLabel("agent_running")).toBe(RUN_PHASE_LABELS.agent_running);
  });

  it("returns the phase itself for unknown phases", () => {
    expect(getPhaseLabel("unknown_phase")).toBe("unknown_phase");
  });
});
