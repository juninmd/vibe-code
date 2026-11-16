export const REACTION_EVENTS_DOC: Record<string, string> = {
  ci_failed: "CI of the task's PR failed; the agent is re-invoked with the failed jobs.",
  changes_requested: "A reviewer requested changes; the agent is re-invoked with the new comments.",
  approved: "PR approved; a notification is sent.",
  agent_stuck: "The agent stopped making progress; a notification is sent.",
  validation_failed:
    "Acceptance criteria were not met; the agent is re-invoked with the unmet criteria.",
};
