import type { AgentRun, Task } from "@vibe-code/shared";
import type { Db } from "../../db";
import type { GitService } from "../../git/git-service";
import type { BroadcastHub } from "../../ws/broadcast";
import type { AgentEngine } from "../engine";
import { handleAgentEvent } from "./event-handler";
import { buildPrompt } from "./prompt";
import { REVIEW_ENABLED, REVIEW_STRICT, runReviewPipeline } from "./review";
import { verifyWorktree } from "./verify";

export async function executeAgent(
  task: Task,
  run: AgentRun,
  engine: AgentEngine,
  repo: any,
  abort: AbortController,
  db: Db,
  git: GitService,
  hub: BroadcastHub,
  sysLog: (content: string) => void,
  onFinish: () => void,
  model?: string
): Promise<void> {
  const barePath = repo.localPath ?? (await git.getBarePath(repo.name));
  const slugTitle = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const branch = `vibe-code/${run.id.slice(0, 8)}/${slugTitle}`;

  const TIMEOUT_MS = Number(process.env.VIBE_CODE_AGENT_TIMEOUT_MS) || 2 * 60 * 60 * 1000;
  let timedOut = false;
  let lastActivity = Date.now();

  const timeoutId = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, TIMEOUT_MS);
  const monitorId = setInterval(() => {
    if (Date.now() - lastActivity > 5 * 60 * 1000) {
      timedOut = true;
      abort.abort();
    }
  }, 30 * 1000);

  let wtPath: string | undefined;
  try {
    db.runs.updateStatus(run.id, "running", { started_at: new Date().toISOString() });
    sysLog("Setting up workspace...");
    wtPath = await git.createWorktree(
      barePath,
      branch,
      repo.name,
      run.id,
      task.baseBranch || repo.defaultBranch
    );
    db.runs.updateStatus(run.id, "running", { worktree_path: wtPath });

    for await (const event of engine.execute(buildPrompt(task), wtPath, {
      runId: run.id,
      signal: abort.signal,
      model,
    })) {
      if (abort.signal.aborted) break;
      await handleAgentEvent(event, run.id, task.id, db, hub, () => {
        lastActivity = Date.now();
      });
    }

    if (abort.signal.aborted) throw new Error(timedOut ? "Agent timed out" : "Cancelled");

    if (await git.hasChanges(wtPath)) {
      sysLog("Committing changes...");
      await git.commitAll(wtPath, `vibe-code: ${task.title}`);
    }

    if (!(await git.hasCommitsAhead(wtPath, repo.defaultBranch)))
      throw new Error("Agent made no changes");

    await verifyWorktree(wtPath, sysLog);

    if (REVIEW_ENABLED) {
      const blockers = await runReviewPipeline(
        task,
        run,
        wtPath,
        repo.defaultBranch,
        db,
        hub,
        (rid, tid, c) => sysLog(c)
      );
      if (blockers.length > 0 && REVIEW_STRICT)
        throw new Error(`Review blockers: ${blockers.join(", ")}`);
    }

    db.tasks.updateField(task.id, "branch_name", branch);
    let prUrl: string | null = null;

    try {
      sysLog("Pushing branch and creating PR...");
      await git.push(wtPath, branch);
      prUrl = await git.createPR(
        wtPath,
        repo.url,
        branch,
        task.title,
        `${task.description}\n\n---\n_Created by vibe-code agent using ${engine.name}_`
      );
      db.tasks.updateField(task.id, "pr_url", prUrl);
      sysLog(`PR created: ${prUrl}`);
    } catch (err: any) {
      sysLog(`Push/PR skipped: ${err.message || String(err)}`);
    }

    const updatedTask = db.tasks.update(task.id, { status: "review" });
    db.runs.updateStatus(run.id, "completed", {
      finished_at: new Date().toISOString(),
      exit_code: 0,
    });
    if (updatedTask) hub.broadcastAll({ type: "task_updated", task: updatedTask });
  } catch (err: any) {
    const errMsg = err.message || String(err);
    const isCancelled = !timedOut && abort.signal.aborted;
    if (!isCancelled) sysLog(`Failed: ${errMsg}`);
    db.runs.updateStatus(run.id, "failed", {
      finished_at: new Date().toISOString(),
      error_message: errMsg,
    });
    db.tasks.update(task.id, { status: isCancelled ? "backlog" : "failed" });
    const finalTask = db.tasks.getById(task.id);
    if (finalTask) hub.broadcastAll({ type: "task_updated", task: finalTask });
  } finally {
    clearTimeout(timeoutId);
    clearInterval(monitorId);
    if (wtPath) {
      try {
        await git.removeWorktree(barePath, wtPath);
      } catch {}
    }
    onFinish();
  }
}
