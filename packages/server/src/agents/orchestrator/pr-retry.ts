import type { Db } from "../../db";
import type { GitService } from "../../git/git-service";
import type { BroadcastHub } from "../../ws/broadcast";
import type { EngineRegistry } from "../registry";

export async function retryPR(
  taskId: string,
  db: Db,
  git: GitService,
  registry: EngineRegistry,
  hub: BroadcastHub
): Promise<string> {
  const task = db.tasks.getById(taskId);
  if (!task) throw new Error("Task not found");
  if (task.status !== "review") throw new Error("Task must be in review status");
  if (!task.branchName) throw new Error("Task has no branch associated");

  const repo = db.repos.getById(task.repoId);
  if (!repo) throw new Error("Repository not found");
  const baseBranch = task.baseBranch || repo.defaultBranch;

  const barePath = repo.localPath ?? git.getBarePath(repo.name);
  const run = db.runs.getLatestByTask(taskId);
  if (!run) throw new Error("No run found for this task");

  const engine = registry.get(run.engine);
  if (!engine) throw new Error(`Engine ${run.engine} not found`);

  // Log the attempt
  db.logs.create(run.id, "system", "Retrying Pull Request creation...");
  hub.broadcastToTask(taskId, {
    type: "agent_log",
    runId: run.id,
    taskId,
    stream: "system",
    content: "Retrying Pull Request creation...",
    timestamp: new Date().toISOString(),
  });

  // Create a temporary worktree using the task branch
  const wtId = `retry-pr-${Date.now()}`;
  const wtPath = await git.createWorktree(
    barePath,
    task.branchName,
    repo.name,
    wtId,
    baseBranch,
    false
  );

  try {
    // Push with -u to ensure it's tracked
    await git.push(wtPath, task.branchName);

    // Create PR
    const prBody = `${task.description}\n\n---\n_Created by vibe-code agent using ${engine.name}_`;
    const prUrl = await git.createPR(
      wtPath,
      repo.url,
      task.branchName,
      task.title,
      prBody,
      baseBranch
    );

    // Update task with PR URL
    db.tasks.updateField(task.id, "pr_url", prUrl);
    const updatedTask = db.tasks.getById(task.id);
    if (updatedTask) {
      hub.broadcastAll({ type: "task_updated", task: updatedTask });
    }

    db.logs.create(run.id, "system", `Pull Request created manually: ${prUrl}`);
    hub.broadcastToTask(taskId, {
      type: "agent_log",
      runId: run.id,
      taskId,
      stream: "system",
      content: `Pull Request created manually: ${prUrl}`,
      timestamp: new Date().toISOString(),
    });

    return prUrl;
  } finally {
    // Cleanup worktree
    await git.removeWorktree(barePath, wtPath);
  }
}
