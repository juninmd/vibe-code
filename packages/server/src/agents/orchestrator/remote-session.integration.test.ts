import { afterEach, expect, it, mock } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../../db";
import type { GitService } from "../../git/git-service";
import { BroadcastHub } from "../../ws/broadcast";
import type { AgentEngine, EngineOptions } from "../engine";
import { executeAgent } from "./executor";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("continues a remote conversation in the same workspace without committing, publishing or removing changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibe-remote-turn-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const db = createDb(":memory:");
  db.settings.set("litellm_enabled", "false");
  const owner = db.workspaces.create({ name: "Remote", slug: "remote" });
  const repo = db.repos.create({
    url: "https://github.com/test/remote.git",
    workspaceId: owner.id,
  });
  db.repos.updateStatus(repo.id, "ready", root);
  const task = db.tasks.create({
    title: "Remote conversation",
    description: "Create a file",
    repoId: repo.id,
    engine: "opencode",
    tags: ["remote-session"],
  });
  const calls: { prompt: string; cwd: string; options: EngineOptions }[] = [];
  const engine: AgentEngine = {
    name: "opencode",
    displayName: "OpenCode",
    isAvailable: async () => true,
    listModels: async () => [],
    abort: () => {},
    sendInput: () => false,
    async *execute(prompt, cwd, options) {
      calls.push({ prompt, cwd, options });
      if (calls.length === 1) await writeFile(join(cwd, "work.txt"), "uncommitted work");
      else expect(await readFile(join(cwd, "work.txt"), "utf8")).toBe("uncommitted work");
      yield { type: "session", sessionId: "ses_same_conversation" };
      yield { type: "log", stream: "stdout", content: "Ready" };
      yield { type: "complete", exitCode: 0 };
    },
  };
  const git = {
    createWorktree: mock(async () => workspace),
    fetchRepo: mock(async () => {}),
    branchExists: mock(async () => true),
    syncWithBase: mock(async () => ({ ok: true })),
    removeWorktree: mock(async () => {}),
    commitAll: mock(async () => {}),
    push: mock(async () => {}),
  };
  const hub = new BroadcastHub(db);
  const finished = mock(() => {});
  try {
    const first = db.runs.create(task.id, engine.name);
    await executeAgent(
      task,
      first,
      engine,
      db.repos.getById(repo.id),
      new AbortController(),
      db,
      git as unknown as GitService,
      hub,
      (content) => {
        db.logs.create(first.id, "system", content);
      },
      finished
    );
    expect(db.runs.getById(first.id)?.sessionId).toBe("ses_same_conversation");
    expect(db.tasks.getById(task.id)?.status).toBe("backlog");
    const second = db.runs.create(task.id, engine.name);
    const latestTask = db.tasks.getById(task.id);
    if (!latestTask) throw new Error("Task disappeared");
    await executeAgent(
      latestTask,
      second,
      engine,
      db.repos.getById(repo.id),
      new AbortController(),
      db,
      git as unknown as GitService,
      hub,
      () => {},
      finished,
      undefined,
      undefined,
      undefined,
      undefined,
      "Now add tests"
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]?.options.resumeSessionId).toBe("ses_same_conversation");
    expect(calls[1]?.prompt).toContain("Now add tests");
    expect(calls[1]?.cwd).toBe(calls[0]?.cwd);
    expect(git.createWorktree).toHaveBeenCalledTimes(1);
    expect(git.removeWorktree).not.toHaveBeenCalled();
    expect(git.commitAll).not.toHaveBeenCalled();
    expect(git.push).not.toHaveBeenCalled();
    expect(existsSync(join(workspace, "work.txt"))).toBe(true);
    expect(db.runs.getById(second.id)?.status).toBe("completed");
    expect(finished).toHaveBeenCalledTimes(2);
  } finally {
    db.raw.close();
  }
}, 15_000);
