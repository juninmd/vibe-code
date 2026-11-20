// Per-turn checkpoints for conversational sessions (idea from T3 Code's turn checkpoints, MIT):
// a commit of the whole worktree, written through a scratch index so the user's index,
// branch and stash stay untouched. Rewinding restores the files and leaves history alone.
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { GitService } from "../../git/git-service";

const IDENTITY = {
  GIT_AUTHOR_NAME: "vibe-code",
  GIT_AUTHOR_EMAIL: "checkpoint@vibe-code.local",
  GIT_COMMITTER_NAME: "vibe-code",
  GIT_COMMITTER_EMAIL: "checkpoint@vibe-code.local",
};

export class CheckpointConflict extends Error {}

async function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    env: { ...GitService.gitEnv(), ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim().slice(-500)}`);
  return stdout;
}

/** Runs `work` against a throwaway index file. */
async function withScratchIndex<T>(work: (env: Record<string, string>) => Promise<T>) {
  const index = join(tmpdir(), `vibe-checkpoint-${randomUUID()}.index`);
  try {
    return await work({ GIT_INDEX_FILE: index });
  } finally {
    await rm(index, { force: true });
  }
}

/** Tree of the worktree as it is now: tracked and untracked files, minus ignored ones. */
async function snapshotTree(worktree: string): Promise<string> {
  return withScratchIndex(async (env) => {
    await git(worktree, ["read-tree", "HEAD"], env);
    await git(worktree, ["add", "-A", "."], env);
    return (await git(worktree, ["write-tree"], env)).trim();
  });
}

/** Records the worktree before a turn; the commit's parent is the HEAD it was taken on. */
export async function captureCheckpoint(worktree: string): Promise<string> {
  const tree = await snapshotTree(worktree);
  const head = (await git(worktree, ["rev-parse", "HEAD"])).trim();
  const sha = (
    await git(
      worktree,
      ["commit-tree", tree, "-p", head, "-m", "vibe-code turn checkpoint"],
      IDENTITY
    )
  ).trim();
  // A ref keeps the commit from being garbage collected.
  await git(worktree, ["update-ref", `refs/vibe/checkpoints/${sha}`, sha]);
  return sha;
}

/** Puts every file back as it was at the checkpoint, removing files created since. */
export async function restoreCheckpoint(worktree: string, sha: string): Promise<void> {
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error("Invalid checkpoint");
  const head = (await git(worktree, ["rev-parse", "HEAD"])).trim();
  const base = (await git(worktree, ["rev-parse", `${sha}^`])).trim();
  if (head !== base)
    throw new CheckpointConflict("Commits were made after this point; rewinding would lose them.");
  const current = await snapshotTree(worktree);
  const added = (
    await git(worktree, ["diff", "--name-only", "-z", "--diff-filter=A", sha, current])
  )
    .split("\0")
    .filter(Boolean);
  const root = resolve(worktree);
  for (const path of added) {
    const target = resolve(root, path);
    if (target.startsWith(root + sep)) await rm(target, { force: true });
  }
  await withScratchIndex(async (env) => {
    await git(worktree, ["read-tree", sha], env);
    await git(worktree, ["checkout-index", "-a", "-f"], env);
  });
  // Staged edits from the undone turns would otherwise survive in the real index.
  await git(worktree, ["reset", "-q"]);
}
