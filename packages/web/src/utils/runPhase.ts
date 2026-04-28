import type { RunPhase } from "@vibe-code/shared";

export const RUN_PHASE_LABELS: Record<RunPhase, string> = {
  setup: "Setting up...",
  worktree_ready: "Workspace ready",
  agent_running: "Agent running",
  validating: "Validating",
  evaluating: "Evaluating",
  reviewing: "Reviewing",
  pr_creating: "Creating PR",
  stalled: "Stalled",
  timed_out: "Timed out",
};

export function getPhaseLabel(phase: string | null | undefined): string {
  if (!phase) return "Running...";
  return RUN_PHASE_LABELS[phase as RunPhase] ?? phase;
}
