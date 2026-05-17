/**
 * Conflict Resolver — detects PRs with merge conflicts and creates continuation tasks
 * to resolve them automatically using the same engine/model as the original task.
 */
import type { Task } from "@vibe-code/shared";
import type { Db } from "../db";
import { createTelegramNotifier } from "../notifications/telegram";
import type { Orchestrator } from "./orchestrator";

const CONFLICT_CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes
const CONFLICT_TAG = "conflict-resolution";

export class ConflictResolver {
  private lastCheckAt = 0;

  constructor(
    private db: Db,
    private orchestrator: Orchestrator
  ) {}

  async check(): Promise<void> {
    if (Date.now() - this.lastCheckAt < CONFLICT_CHECK_INTERVAL_MS) return;
    this.lastCheckAt = Date.now();

    const reviewTasks = this.db.tasks.list(undefined, "review");
    const candidates: Task[] = reviewTasks.filter(
      (t) => t.prUrl && !this.hasActiveConflictChild(t.id)
    );

    if (candidates.length === 0) return;

    const token = this.db.settings.get("github_token") || process.env.GITHUB_TOKEN;
    if (!token) {
      console.warn("[conflict-resolver] No GitHub token — skipping PR conflict check");
      return;
    }

    for (const task of candidates) {
      try {
        const conflicting = await this.isPRConflicting(task.prUrl!, token);
        if (conflicting) {
          console.log(
            `[conflict-resolver] PR conflict detected for task ${task.id}: ${task.prUrl}`
          );
          await this.createConflictResolutionTask(task);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[conflict-resolver] Error checking task ${task.id}: ${msg}`);
      }
    }
  }

  private hasActiveConflictChild(parentTaskId: string): boolean {
    const children = this.db.tasks.listChildren(parentTaskId);
    return children.some(
      (t) =>
        t.tags?.includes(CONFLICT_TAG) && (t.status === "backlog" || t.status === "in_progress")
    );
  }

  private async isPRConflicting(prUrl: string, token: string): Promise<boolean> {
    // Parse owner/repo/number from URL like https://github.com/owner/repo/pull/123
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return false;
    const [, owner, repo, number] = match;

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "vibe-code",
      },
    });

    if (!res.ok) return false;
    const data = (await res.json()) as {
      mergeable?: string | boolean | null;
      mergeable_state?: string;
    };

    // GitHub returns mergeable=false or mergeable_state="dirty" for conflicts
    return data.mergeable === false || data.mergeable_state === "dirty";
  }

  private async createConflictResolutionTask(parentTask: Task): Promise<void> {
    const repo = this.db.repos.getById(parentTask.repoId);
    if (!repo) return;

    const baseBranch = parentTask.baseBranch || repo.defaultBranch;
    const branch = parentTask.branchName;
    if (!branch) return;

    const description = `
This is an automatic conflict resolution task for PR: ${parentTask.prUrl}

Branch \`${branch}\` has merge conflicts with \`${baseBranch}\`. Follow these steps EXACTLY:

STEP 1 — Fetch and start rebase:
\`\`\`
git fetch origin
git rebase origin/${baseBranch}
\`\`\`

STEP 2 — Check which files have conflicts:
\`\`\`
git diff --name-only --diff-filter=U
\`\`\`

STEP 3 — For each conflicting file: open it, remove ALL conflict markers (<<<<<<<, =======, >>>>>>>), keep the correct merged content.

STEP 4 — Stage ALL resolved files (REQUIRED before continuing):
\`\`\`
git add -A
\`\`\`

STEP 5 — Verify NO unmerged files remain before continuing:
\`\`\`
git diff --name-only --diff-filter=U
\`\`\`
If this command shows any files, go back to STEP 3 for those files.

STEP 6 — Continue the rebase (DO NOT run git commit — use rebase --continue):
\`\`\`
GIT_EDITOR=true git rebase --continue
\`\`\`

STEP 7 — Force-push:
\`\`\`
git push --force-with-lease origin ${branch}
\`\`\`

CRITICAL RULES:
- NEVER run \`git commit\` during a rebase — always use \`git rebase --continue\`
- If rebase was not started (branch was already up to date), just push: \`git push origin ${branch}\`
- If \`git rebase --continue\` asks for a commit message, use: \`GIT_EDITOR=true git rebase --continue\` to accept the default
- Do NOT create a new PR — the existing PR (${parentTask.prUrl}) updates automatically on push
- Do NOT add new features — only resolve conflicts
`.trim();

    const conflictTask = this.db.tasks.create({
      repoId: parentTask.repoId,
      title: `fix(conflicts): resolve merge conflicts for "${parentTask.title.slice(0, 50)}"`,
      description,
      engine: parentTask.engine ?? undefined,
      model: parentTask.model ?? undefined,
      baseBranch: baseBranch,
      parentTaskId: parentTask.id,
      tags: [CONFLICT_TAG],
      status: "backlog",
    });

    // Set branch so executor reuses the existing PR branch instead of creating a new one
    this.db.tasks.updateField(conflictTask.id, "branch_name", branch);

    console.log(
      `[conflict-resolver] Created conflict task ${conflictTask.id} for parent ${parentTask.id}`
    );

    // Notify via Telegram
    const telegram = createTelegramNotifier(this.db);
    if (telegram.isConfigured()) {
      const repoName = repo.name;
      telegram
        .send(
          `🔀 <b>Merge conflict detected</b>\n\n` +
            `<b>Task:</b> ${parentTask.title.slice(0, 80)}\n` +
            `<b>Repo:</b> ${repoName}\n` +
            `<b>Branch:</b> <code>${branch}</code>\n` +
            `<b>PR:</b> <a href="${parentTask.prUrl}">${parentTask.prUrl}</a>\n\n` +
            `⚙️ Auto-resolution task created and queued.`
        )
        .catch((e) => console.warn("[conflict-resolver] Telegram notify failed:", e));
    }

    try {
      await this.orchestrator.launch(conflictTask);
      console.log(`[conflict-resolver] Launched conflict task ${conflictTask.id}`);
    } catch (err) {
      // No slots available — stays in backlog, sweepBacklog will pick it up
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[conflict-resolver] Task queued (no slots): ${msg}`);
    }
  }

  async notifyConflictResolved(task: Task): Promise<void> {
    const repo = this.db.repos.getById(task.repoId);
    const telegram = createTelegramNotifier(this.db);
    if (!telegram.isConfigured()) return;
    await telegram
      .send(
        `✅ <b>Merge conflicts resolved!</b>\n\n` +
          `<b>Task:</b> ${task.title.slice(0, 80)}\n` +
          `<b>Repo:</b> ${repo?.name ?? task.repoId}\n` +
          `<b>Branch:</b> <code>${task.branchName ?? "?"}</code>\n` +
          (task.prUrl ? `<b>PR:</b> <a href="${task.prUrl}">${task.prUrl}</a>` : "")
      )
      .catch((e) => console.warn("[conflict-resolver] Telegram notify failed:", e));
  }
}
