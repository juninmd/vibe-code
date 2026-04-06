import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRun, Task } from "@vibe-code/shared";
import type { Db } from "../../db";
import type { GitService } from "../../git/git-service";
import type { BroadcastHub } from "../../ws/broadcast";
import type { AgentEngine } from "../engine";
import { handleAgentEvent } from "./event-handler";
import { buildPromptAsync } from "./prompt";
import { REVIEW_ENABLED, REVIEW_STRICT, runReviewPipeline } from "./review";
import { logAgentFinish, logAgentStart, logOrchestratorEvent } from "./terminal-logger";
import { verifyWorktree } from "./verify";

const REVIEW_AUTO_APPLY = process.env.VIBE_CODE_REVIEW_AUTO_APPLY !== "false";
const DOCS_AUTO_APPLY = process.env.VIBE_CODE_DOCS_AUTO_APPLY !== "false";

function taskSlug(task: Task): string {
  return task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function docsRelativePath(task: Task): string {
  const slug = taskSlug(task);
  return `docs/tasks/${task.id}-${slug || "task"}.md`;
}

function buildReviewAutofixPrompt(task: Task, findings: string[]): string {
  const formattedFindings = findings
    .slice(0, 30)
    .map((f, i) => `${i + 1}. ${f}`)
    .join("\n");
  return [
    "You are continuing an existing coding task after review feedback.",
    "Apply the actionable review suggestions below directly in the repository.",
    "",
    "Rules:",
    "- Implement concrete fixes in code and tests when relevant.",
    "- If changed logic has no tests, add automated tests.",
    "- If the task creates a new frontend project, use React + Vite (prefer TypeScript) instead of plain HTML/JS.",
    "- Do NOT rewrite unrelated files.",
    "- Keep fixes minimal and aligned with the existing stack.",
    "- If a suggestion is not applicable, skip it and continue with the rest.",
    "- Do not open PRs or perform git push; only change files.",
    "",
    "Task context:",
    `Title: ${task.title}`,
    task.description ? `Description: ${task.description}` : "",
    "",
    "Actionable review findings:",
    formattedFindings,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDocsAutofixPrompt(task: Task, findings: string[]): string {
  const docsFile = docsRelativePath(task);
  const formattedFindings = findings
    .slice(0, 30)
    .map((f, i) => `${i + 1}. ${f}`)
    .join("\n");
  return [
    "You are the documentation finisher for this task.",
    "Implement documentation updates directly in the repository.",
    "",
    "Required actions:",
    `1) Create or update ${docsFile} with detailed content.`,
    "2) Include clear sections: Contexto, Funcionalidades entregues, Decisões de arquitetura, Impactos e riscos, Como validar, Rollback, Próximos passos.",
    "3) If behavior/contracts/workflow changed, update README.md and/or AGENTS.md accordingly.",
    "4) Ensure docs explicitly mention testing strategy and commands used.",
    "5) If frontend was created from scratch, document why React + Vite was used and project structure.",
    "4) Keep text factual and based only on current repository changes.",
    "6) Do not push or open PR; only modify files.",
    "",
    "Task context:",
    `Title: ${task.title}`,
    task.description ? `Description: ${task.description}` : "",
    "",
    "Documentation review findings:",
    formattedFindings ||
      "(no explicit findings; still create detailed docs file based on current diff)",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Appends to .gitignore in the worktree, creating it if needed. */
async function ensureGitignoreEntry(wtPath: string, entry: string): Promise<void> {
  // Use .git/info/exclude instead of .gitignore to avoid generating tracked file changes.
  const gitignorePath = join(wtPath, ".git", "info", "exclude");
  try {
    const content = await readFile(gitignorePath, "utf8").catch(() => "");
    const lines = content.split("\n").map((l) => l.trim());
    if (!lines.includes(entry)) {
      await appendFile(gitignorePath, `\n${entry}\n`, "utf8");
    }
  } catch {
    // Best effort — don't block execution if .gitignore write fails
  }
}

/** Builds a rich PR body with changed files summary. */
async function buildPRBody(
  task: Task,
  engineName: string,
  wtPath: string,
  baseBranch: string,
  git: GitService,
  _barePath: string
): Promise<string> {
  const docsRel = docsRelativePath(task);
  const docsFile = join(wtPath, docsRel);
  const lines: string[] = [];

  if (task.description?.trim()) {
    lines.push(`## Description\n${task.description.trim()}`);
  }

  // Try to add changed files summary
  try {
    const files = await git.diffSummary(baseBranch, "HEAD", { cwd: wtPath });
    if (files.length > 0) {
      const added = files.filter((f) => f.status === "added").length;
      const modified = files.filter((f) => f.status === "modified").length;
      const deleted = files.filter((f) => f.status === "deleted").length;
      const totalAdd = files.reduce((s, f) => s + f.additions, 0);
      const totalDel = files.reduce((s, f) => s + f.deletions, 0);

      lines.push(
        `## Changes\n` +
          `**${files.length} file(s)** changed ` +
          `(+${totalAdd} / -${totalDel} lines)` +
          (added ? ` · ${added} added` : "") +
          (modified ? ` · ${modified} modified` : "") +
          (deleted ? ` · ${deleted} deleted` : "")
      );

      const fileList = files
        .slice(0, 20)
        .map((f) => {
          const icon =
            f.status === "added"
              ? "🆕"
              : f.status === "deleted"
                ? "🗑"
                : f.status === "renamed"
                  ? "📝"
                  : "✏️";
          return `- ${icon} \`${f.path}\` (+${f.additions}/-${f.deletions})`;
        })
        .join("\n");
      lines.push(fileList);
      if (files.length > 20) {
        lines.push(`_...and ${files.length - 20} more files_`);
      }
    }
  } catch {
    // Non-fatal — diff summary is best-effort
  }

  // If docs file was generated, include it to keep PR description detailed and traceable.
  try {
    const docsText = (await readFile(docsFile, "utf8")).trim();
    if (docsText) {
      const clipped =
        docsText.length > 8000 ? `${docsText.slice(0, 8000)}\n\n...[truncated]` : docsText;
      lines.push(`## Detailed Notes (from ${docsRel})\n${clipped}`);
    }
  } catch {
    // Optional docs file
  }

  lines.push(`---\n_Created by vibe-code agent using **${engineName}**_ 🤖`);
  return lines.join("\n\n");
}

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
  const INACTIVITY_MS = Number(process.env.VIBE_CODE_INACTIVITY_MS) || 10 * 60 * 1000;
  let timedOut = false;
  let lastActivity = Date.now();

  const effectiveModel = model ?? "opencode/minimax-m2.5-free";
  logAgentStart(task.id, engine.name, effectiveModel, repo.name);

  const timeoutId = setTimeout(() => {
    timedOut = true;
    logOrchestratorEvent(
      `Task ${task.id.slice(0, 8)} timed out after ${TIMEOUT_MS / 60000}m`,
      "warn"
    );
    abort.abort();
  }, TIMEOUT_MS);

  const monitorId = setInterval(() => {
    const inactiveSecs = Math.round((Date.now() - lastActivity) / 1000);
    if (Date.now() - lastActivity > INACTIVITY_MS) {
      timedOut = true;
      logOrchestratorEvent(
        `Task ${task.id.slice(0, 8)} inactive for ${inactiveSecs}s — aborting`,
        "warn"
      );
      abort.abort();
    }
  }, 30_000);

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

    // Ensure opencode.json won't pollute git history
    await ensureGitignoreEntry(wtPath, "opencode.json");

    sysLog(`Workspace ready at ${wtPath}`);
    sysLog(`Branch: ${branch}`);

    let agentExitCode: number | null = null;
    const prompt = await buildPromptAsync(task, wtPath);
    for await (const event of engine.execute(prompt, wtPath, {
      runId: run.id,
      signal: abort.signal,
      model,
    })) {
      if (abort.signal.aborted) break;
      if (event.type === "complete") {
        agentExitCode = event.exitCode ?? 0;
        continue;
      }
      await handleAgentEvent(event, run.id, task.id, db, hub, () => {
        lastActivity = Date.now();
      });
    }

    if (abort.signal.aborted) throw new Error(timedOut ? "Agent timed out" : "Cancelled");

    if (agentExitCode !== null && agentExitCode !== 0) {
      throw new Error(`Agent exited with code ${agentExitCode}`);
    }

    const baseBranch = task.baseBranch || repo.defaultBranch;

    if (await git.hasChanges(wtPath)) {
      sysLog("Committing changes...");
      await git.commitAll(wtPath, `feat: ${task.title}`);
      sysLog("Changes committed ✓");
    }

    if (!(await git.hasCommitsAhead(wtPath, baseBranch))) throw new Error("Agent made no changes");

    await verifyWorktree(wtPath, sysLog);

    if (REVIEW_ENABLED) {
      sysLog("Running review pipeline...");
      const reviewResult = await runReviewPipeline(
        task,
        run,
        wtPath,
        baseBranch,
        db,
        hub,
        (_rid, _tid, content) => sysLog(content),
        engine.name,
        model
      );

      if (REVIEW_AUTO_APPLY && reviewResult.actionableFindings.length > 0) {
        sysLog(
          `Applying ${reviewResult.actionableFindings.length} review suggestion(s) automatically...`
        );
        let autofixExitCode: number | null = null;
        const autofixPrompt = buildReviewAutofixPrompt(task, reviewResult.actionableFindings);
        for await (const event of engine.execute(autofixPrompt, wtPath, {
          runId: run.id,
          signal: abort.signal,
          model,
        })) {
          if (abort.signal.aborted) break;
          if (event.type === "complete") {
            autofixExitCode = event.exitCode ?? 0;
            continue;
          }
          await handleAgentEvent(event, run.id, task.id, db, hub, () => {
            lastActivity = Date.now();
          });
        }

        if (abort.signal.aborted) throw new Error(timedOut ? "Agent timed out" : "Cancelled");

        if (autofixExitCode !== null && autofixExitCode !== 0) {
          throw new Error(`Review auto-apply exited with code ${autofixExitCode}`);
        }

        if (await git.hasChanges(wtPath)) {
          await git.commitAll(wtPath, `chore: apply review suggestions for ${task.title}`);
          sysLog("Review suggestions applied and committed ✓");
          await verifyWorktree(wtPath, sysLog);
        } else {
          sysLog("No file changes produced by review auto-apply.");
        }
      }

      if (DOCS_AUTO_APPLY) {
        sysLog("Running docs finishing step...");
        let docsExitCode: number | null = null;
        const docsPrompt = buildDocsAutofixPrompt(task, reviewResult.docsFindings);
        for await (const event of engine.execute(docsPrompt, wtPath, {
          runId: run.id,
          signal: abort.signal,
          model,
        })) {
          if (abort.signal.aborted) break;
          if (event.type === "complete") {
            docsExitCode = event.exitCode ?? 0;
            continue;
          }
          await handleAgentEvent(event, run.id, task.id, db, hub, () => {
            lastActivity = Date.now();
          });
        }

        if (abort.signal.aborted) throw new Error(timedOut ? "Agent timed out" : "Cancelled");
        if (docsExitCode !== null && docsExitCode !== 0) {
          throw new Error(`Docs step exited with code ${docsExitCode}`);
        }

        if (await git.hasChanges(wtPath)) {
          await git.commitAll(wtPath, `docs: add implementation notes for ${task.title}`);
          sysLog("Docs step applied and committed ✓");
          await verifyWorktree(wtPath, sysLog);
        } else {
          sysLog("Docs step finished with no file changes.");
        }
      }

      if (reviewResult.blockers.length > 0 && REVIEW_STRICT)
        throw new Error(`Review blockers: ${reviewResult.blockers.join(", ")}`);
    }

    db.tasks.updateField(task.id, "branch_name", branch);
    let prUrl: string | null = null;

    try {
      sysLog("Pushing branch to origin...");
      await git.push(wtPath, branch);
      sysLog("Branch pushed ✓");

      sysLog("Creating pull request...");
      const prBody = await buildPRBody(task, engine.name, wtPath, baseBranch, git, barePath);
      prUrl = await git.createPR(wtPath, repo.url, branch, task.title, prBody, baseBranch);
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
    logAgentFinish(task.id, "completed", prUrl ? `PR: ${prUrl}` : "no PR");
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
    logAgentFinish(task.id, isCancelled ? "cancelled" : "failed", errMsg);
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
