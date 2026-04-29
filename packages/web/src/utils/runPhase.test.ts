import { describe, expect, it } from "vitest";
import { getPhaseLabel, RUN_PHASE_LABELS } from "./runPhase";

describe("getPhaseLabel", () => {
  it("returns 'Running...' when phase is null or undefined", () => {
    expect(getPhaseLabel(null)).toBe("Running...");
    expect(getPhaseLabel(undefined)).toBe("Running...");
    expect(getPhaseLabel("")).toBe("Running...");
  });

  it("returns the corresponding label from RUN_PHASE_LABELS", () => {
    expect(getPhaseLabel("setup")).toBe(RUN_PHASE_LABELS.setup);
    expect(getPhaseLabel("worktree_ready")).toBe(RUN_PHASE_LABELS.worktree_ready);
    expect(getPhaseLabel("agent_running")).toBe(RUN_PHASE_LABELS.agent_running);
  });

  it("returns the original phase name if not in RUN_PHASE_LABELS", () => {
    expect(getPhaseLabel("unknown_phase")).toBe("unknown_phase");
  });
});
