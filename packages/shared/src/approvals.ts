/** Tag on a remote session whose agent asks before editing files or running commands. */
export const SUPERVISED_TAG = "supervised";

export type PermissionMode = "full" | "supervised";
export type ApprovalReply = "once" | "always" | "reject";

/** A tool call waiting for the operator (idea from T3 Code's approval mode, MIT). */
export interface ToolApproval {
  id: string;
  taskId: string;
  runId: string;
  /** OpenCode permission key: edit, bash, webfetch, external_directory… */
  permission: string;
  /** Files, commands or URLs the call targets. */
  patterns: string[];
  /** Unified diff for edits, truncated. */
  diff?: string;
  createdAt: string;
}

export function permissionModeOf(tags: readonly string[] | undefined): PermissionMode {
  return tags?.includes(SUPERVISED_TAG) ? "supervised" : "full";
}
