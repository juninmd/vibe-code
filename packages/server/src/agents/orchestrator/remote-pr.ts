import { access } from "node:fs/promises";
import { REMOTE_SESSION_TAG, type Task } from "@vibe-code/shared";
import type { Db } from "../../db";
import type { GitService } from "../../git/git-service";
import type { BroadcastHub } from "../../ws/broadcast";

export class RemotePullRequestError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_state" | "nothing_to_publish" | "publish_failed",
    message: string
  ) {
    super(message);
  }
}

export interface RemotePullRequestInput {
  title?: string;
  body?: string;
}

export interface RemotePullRequestResult {
  prUrl: string;
  branch: string;
  /** false when the PR already existed and only new commits were pushed. */
  created: boolean;
}

/** First meaningful line of the conversation's prompt, as a PR/commit title. */
export function remoteSessionTitle(task: Pick<Task, "title" | "description">): string {
  const line =
    task.description
      .split(/\r?\n/)
      .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
      .find((l) => l.length > 0) ?? task.title;
  return line.length > 72 ? `${line.slice(0, 69).trimEnd()}...` : line;
}

/**
 * "Create PR" for a conversational session, like Claude Code on the web:
 * commit whatever the agent left in the session workspace, push the session
 * branch and open (or update) the pull request. The workspace and the CLI
 * session stay intact, so the conversation can continue and later pushes land
 * on the same PR.
 */
export async function publishRemoteSession(
  taskId: string,
  input: RemotePullRequestInput,
  deps: {
    db: Db;
    git: Pick<GitService, "commitAll" | "hasCommitsAhead" | "push" | "createPR">;
    hub: BroadcastHub;
    isRunning: (taskId: string) => boolean;
  }
): Promise<RemotePullRequestResult> {
  const { db, git, hub } = deps;
  const task = db.tasks.getById(taskId);
  if (!task) throw new RemotePullRequestError("not_found", "Session not found");
  if (!task.tags.includes(REMOTE_SESSION_TAG))
    throw new RemotePullRequestError(
      "invalid_state",
      "Only conversational sessions can be published here."
    );
  if (deps.isRunning(taskId) || task.status === "in_progress")
    throw new RemotePullRequestError(
      "invalid_state",
      "Wait for the current turn to finish before creating the pull request."
    );
  const repo = db.repos.getById(task.repoId);
  if (!repo) throw new RemotePullRequestError("not_found", "Repository not found");
  const run = db.runs.listByTask(taskId).find((r) => !!r.worktreePath);
  const branch = task.branchName;
  if (!run?.worktreePath || !branch)
    throw new RemotePullRequestError("invalid_state", "This session has no workspace yet.");
  try {
    await access(run.worktreePath);
  } catch {
    throw new RemotePullRequestError(
      "invalid_state",
      "The session workspace is no longer available."
    );
  }

  const log = (content: string) => {
    const entry = db.logs.create(run.id, "system", content);
    hub.broadcastToTask(taskId, {
      type: "agent_log",
      runId: run.id,
      taskId,
      stream: "system",
      content,
      timestamp: entry.timestamp,
    });
  };

  const baseBranch = task.baseBranch || repo.defaultBranch;
  const title = input.title?.trim() || remoteSessionTitle(task);
  try {
    await git.commitAll(run.worktreePath, title);
    if (!(await git.hasCommitsAhead(run.worktreePath, baseBranch)))
      throw new RemotePullRequestError(
        "nothing_to_publish",
        `No changes relative to ${baseBranch}. Ask the agent to make changes first.`
      );
    log(`Pushing ${branch}...`);
    await git.push(run.worktreePath, branch);
    if (task.prUrl) {
      log(`Pull request updated: ${task.prUrl}`);
      return { prUrl: task.prUrl, branch, created: false };
    }
    const engine = run.engine || task.engine || "opencode";
    const model = task.model?.split("#")[0];
    const body =
      input.body?.trim() ||
      [
        task.description.trim(),
        "",
        "---",
        `_Opened from a vibe-code remote session (${engine}${model ? ` · ${model}` : ""})._`,
      ].join("\n");
    const prUrl = await git.createPR(run.worktreePath, repo.url, branch, title, body, baseBranch);
    db.tasks.updateField(task.id, "pr_url", prUrl);
    const updated = db.tasks.getById(task.id);
    if (updated) hub.broadcastAll({ type: "task_updated", task: updated });
    log(`Pull request created: ${prUrl}`);
    return { prUrl, branch, created: true };
  } catch (err) {
    if (err instanceof RemotePullRequestError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    log(`Pull request failed: ${message}`);
    throw new RemotePullRequestError("publish_failed", message);
  }
}
