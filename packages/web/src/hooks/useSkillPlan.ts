import type { SkillPlan, TerminalState } from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

interface Options {
  taskId: string;
  /** Latest terminal state; null while it is still loading. */
  state: TerminalState | null;
  onState: (state: TerminalState) => void;
  onError: (error: unknown) => void;
}

export interface SkillPlanControls {
  /** What the agent plugin contains (or will contain), with the reason for each skill. */
  plan: SkillPlan | null;
  /** The operator's own list, for a task that has no workspace yet. */
  startSkills: string[] | undefined;
  /** Replace the picks; this makes the plan manual. */
  choose: (skills: string[]) => void;
  /** Hand the choice back to vibe-code. */
  auto: () => void;
}

/**
 * Keeps the task's skill plan in one place. Once a workspace exists the plan lives on the
 * server (and changes go there); before that, picks stay local and are previewed so the
 * operator sees what will be applied before pressing Start.
 */
export function useSkillPlan({ taskId, state, onState, onError }: Options): SkillPlanControls {
  const ready = state !== null;
  const hasWorkspace = !!state?.cwd;
  const [pick, setPick] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<SkillPlan | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a different task starts from scratch
  useEffect(() => {
    setPick(null);
    setPreview(null);
  }, [taskId]);

  useEffect(() => {
    if (!ready || hasWorkspace) return;
    let cancelled = false;
    api.terminal
      .previewSkills(taskId, pick ?? undefined)
      .then((next) => !cancelled && setPreview(next))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [taskId, ready, hasWorkspace, pick]);

  const send = useCallback(
    (choice: { skills: string[] } | { mode: "auto" }) => {
      api.terminal.setSkills(taskId, choice).then(onState).catch(onError);
    },
    [taskId, onState, onError]
  );

  const choose = useCallback(
    (skills: string[]) => (hasWorkspace ? send({ skills }) : setPick(skills)),
    [hasWorkspace, send]
  );
  const auto = useCallback(
    () => (hasWorkspace ? send({ mode: "auto" }) : setPick(null)),
    [hasWorkspace, send]
  );

  const plan: SkillPlan | null =
    hasWorkspace && state ? { mode: state.skillMode, applied: state.applied } : preview;
  return { plan, startSkills: hasWorkspace ? undefined : (pick ?? undefined), choose, auto };
}
