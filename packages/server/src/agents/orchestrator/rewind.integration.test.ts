import { afterEach, expect, it, mock } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../../db";
import type { GitService } from "../../git/git-service";
import { BroadcastHub } from "../../ws/broadcast";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { executeAgent } from "./executor";
import { rewindSession } from "./rewind";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text());
}

it("rewinds a session to before a turn: files restored, later turns dropped, next turn starts fresh", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibe-rewind-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  await Bun.write(join(workspace, "README.md"), "app\n");
  await git(workspace, "init", "-q");
  await git(workspace, "-c", "user.email=t@t.t", "-c", "user.name=t", "add", ".");
  await git(workspace, "-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "-qm", "init");

  const db = createDb(":memory:");
  db.settings.set("litellm_enabled", "false");
  const owner = db.workspaces.create({ name: "Remote", slug: "remote" });
  const repo = db.repos.create({ url: "https://github.com/test/r.git", workspaceId: owner.id });
  db.repos.updateStatus(repo.id, "ready", root);
  const task = db.tasks.create({
    title: "Rewind",
    description: "Create email.ts",
    repoId: repo.id,
    engine: "opencode",
    tags: ["remote-session"],
  });
  const calls: { prompt: string; options: EngineOptions }[] = [];
  const engine: AgentEngine = {
    name: "opencode",
    displayName: "OpenCode",
    isAvailable: async () => true,
    listModels: async () => [],
    abort: () => {},
    sendInput: () => false,
    async *execute(prompt, cwd, options): AsyncGenerator<AgentEvent> {
      calls.push({ prompt, options });
      const turn = calls.length;
      await writeFile(join(cwd, `turn${turn}.txt`), `turn ${turn}\n`);
      await writeFile(join(cwd, "README.md"), `app after turn ${turn}\n`);
      yield { type: "session", sessionId: `ses_${turn}` };
      yield { type: "log", stream: "stdout", content: `Done with turn ${turn}` };
      yield { type: "complete", exitCode: 0 };
    },
  };
  const gitService = {
    createWorktree: mock(async () => workspace),
    fetchRepo: mock(async () => {}),
    branchExists: mock(async () => true),
    syncWithBase: mock(async () => ({ ok: true })),
    removeWorktree: mock(async () => {}),
  };
  const turn = async (input?: string) => {
    const current = db.tasks.getById(task.id);
    if (!current) throw new Error("Task disappeared");
    const run = db.runs.create(task.id, engine.name);
    if (input) db.logs.create(run.id, "stdin", input);
    await executeAgent(
      current,
      run,
      engine,
      db.repos.getById(repo.id),
      new AbortController(),
      db,
      gitService as unknown as GitService,
      new BroadcastHub(db),
      (content) => {
        db.logs.create(run.id, "system", content);
      },
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      input
    );
    return run;
  };
  try {
    const first = await turn();
    const second = await turn("Add tests");
    await turn("Rename the file");
    expect(db.runs.getById(second.id)?.checkpoint).toMatch(/^[0-9a-f]{40}$/);

    expect((await rewindSession(db, task.id, first.id)).ok).toBe(false);
    const outcome = await rewindSession(db, task.id, second.id);
    expect(outcome).toMatchObject({ ok: true, message: "Add tests" });
    if (!outcome.ok) throw new Error("rewind failed");
    expect(outcome.rewound).toHaveLength(2);
    expect(await readFile(join(workspace, "README.md"), "utf8")).toBe("app after turn 1\n");
    expect(existsSync(join(workspace, "turn1.txt"))).toBe(true);
    expect(existsSync(join(workspace, "turn2.txt"))).toBe(false);
    expect(existsSync(join(workspace, "turn3.txt"))).toBe(false);

    await turn("Add tests, but with vitest");
    const last = calls.at(-1);
    // The agent's own session still remembers the undone turns: start a new one.
    expect(last?.options.resumeSessionId).toBeUndefined();
    expect(last?.prompt).toContain("rewound");
    expect(last?.prompt).toContain("Done with turn 1");
    expect(last?.prompt).not.toContain("Done with turn 2");
    expect(last?.prompt).not.toContain("Rename the file");
  } finally {
    db.raw.close();
  }
}, 30_000);
