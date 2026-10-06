/**
 * End-to-end test of the task terminal: real git repo + worktree, real PTY and a
 * fake `claude` CLI on PATH that echoes its arguments and stdin.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WsServerMessage } from "@vibe-code/shared";
import type { AgentEngine } from "../agents/engine";
import { EngineRegistry } from "../agents/registry";
import { createDb } from "../db";
import { GitService } from "../git/git-service";
import type { SkillsLoader } from "../skills/loader";
import type { BroadcastHub } from "../ws/broadcast";
import { TerminalController, TerminalError } from "./controller";

const posix = process.platform !== "win32";

let root: string;
let originalPath: string | undefined;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

function stubEngine(name: string, available: boolean): AgentEngine {
  return {
    name,
    displayName: name,
    isAvailable: async () => available,
    listModels: async () => [],
    execute: async function* () {},
    abort: () => {},
    sendInput: () => false,
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, what: string, ms = 8_000) {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > ms) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

async function makeEnv() {
  const db = createDb(":memory:");
  const dataDir = join(root, `data-${Math.random().toString(36).slice(2)}`);
  const gitService = new GitService(dataDir);

  const messages: WsServerMessage[] = [];
  const hub = {
    broadcastAll: (m: WsServerMessage) => messages.push(m),
    broadcastToTask: (_taskId: string, m: WsServerMessage) => messages.push(m),
  } as unknown as BroadcastHub;

  const registry = new EngineRegistry();
  registry.register(stubEngine("claude-code", true));
  registry.register(stubEngine("opencode", false));

  const skillDir = join(root, "catalog", "tdd");
  const skills = {
    load: async () => ({
      skills: [
        {
          name: "tdd",
          description: "Write failing tests first, then make them pass",
          tags: ["test", "tdd"],
          category: "skill",
          filePath: join(skillDir, "SKILL.md"),
        },
        {
          name: "vibe-code-orchestrator",
          description: "Create sub-tasks",
          category: "skill",
          filePath: "virtual://vibe-code-orchestrator",
        },
      ],
      rules: [],
      agents: [],
      workflows: [],
    }),
    getFileContent: async () => "Use $VIBE_CODE_API_URL to create sub-tasks.",
  } as unknown as SkillsLoader;

  const fixture = join(root, `fixture-${Math.random().toString(36).slice(2)}`);
  await mkdir(fixture, { recursive: true });
  await git(fixture, "init", "-q", "--initial-branch=main");
  await git(fixture, "config", "user.email", "t@t.t");
  await git(fixture, "config", "user.name", "t");
  await writeFile(join(fixture, "README.md"), "# fixture\n");
  await git(fixture, "add", "-A");
  await git(fixture, "commit", "-qm", "init");

  const repo = db.repos.create({ url: fixture, defaultBranch: "main" });
  const localPath = await gitService.cloneRepo(fixture, repo.name);
  db.repos.updateStatus(repo.id, "ready", localPath);

  const task = db.tasks.create({
    title: "Fix login",
    description: "Redirect loops on /login",
    repoId: repo.id,
    engine: "claude-code",
  });

  const controller = new TerminalController({ db, git: gitService, registry, hub, skills });
  const output = () =>
    messages
      .filter(
        (m): m is Extract<WsServerMessage, { type: "terminal_output" }> =>
          m.type === "terminal_output"
      )
      .map((m) => m.chunk)
      .join("");
  return { db, controller, task, output, messages };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "terminal-controller-"));
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });
  // Fake Claude Code: prints argv, then reacts to one line of keyboard input.
  await writeFile(
    join(bin, "claude"),
    [
      "#!/bin/sh",
      'echo "claude-args:[$*]"',
      "read line",
      'if [ "$line" = "work" ]; then echo generated > generated.txt; fi',
      'echo "typed:$line"',
      "exit 0",
      "",
    ].join("\n")
  );
  await chmod(join(bin, "claude"), 0o755);

  const skillDir = join(root, "catalog", "tdd");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: tdd\ndescription: test first\n---\nWrite tests first."
  );

  originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${process.env.PATH}`;
});

afterAll(async () => {
  process.env.PATH = originalPath;
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!posix)("TerminalController", () => {
  it("runs Claude Code in an isolated worktree with the task prompt and the skills as a plugin", async () => {
    const { controller, db, task, output } = await makeEnv();

    const state = await controller.start(task.id, { skills: ["tdd"], cols: 100, rows: 30 });

    expect(state.live).toBe(true);
    expect(state.engine).toBe("claude-code");
    expect(state.skills).toEqual(["vibe-code-orchestrator", "tdd"]);
    expect(state.skillMode).toBe("manual");
    expect(state.cwd).toBeTruthy();
    const plugin = join(state.cwd as string, ".vibe-code", "plugin");
    expect(existsSync(join(plugin, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(plugin, "skills", "tdd", "SKILL.md"))).toBe(true);
    // Nothing lands in the repository's own .claude directory.
    expect(existsSync(join(state.cwd as string, ".claude"))).toBe(false);
    expect(existsSync(join(state.cwd as string, ".vibe-code", "TASK.md"))).toBe(true);

    const running = db.tasks.getById(task.id);
    expect(running?.status).toBe("in_progress");
    expect(running?.branchName).toMatch(/^vibe-code\/.+\/fix-login$/);
    expect(db.runs.getLatestByTask(task.id)?.status).toBe("running");

    await waitFor(() => output().includes("claude-args:"), "claude to start");
    expect(output()).toContain("Fix login");
    expect(output()).toContain("Redirect loops");
    expect(output()).toContain(`--plugin-dir ${plugin}`);

    controller.input(task.id, "hello\n");
    await waitFor(() => output().includes("typed:hello"), "keyboard input to reach claude");
  });

  it("sends a finished session without changes back to the backlog", async () => {
    const { controller, db, task } = await makeEnv();
    await controller.start(task.id);
    controller.input(task.id, "nothing\n");

    await waitFor(
      () => db.tasks.getById(task.id)?.status === "backlog",
      "task to return to backlog"
    );
    expect(db.runs.getLatestByTask(task.id)?.status).toBe("completed");
    expect((await controller.state(task.id)).live).toBe(false);
  });

  it("moves a session that produced changes to review and commits them on finish", async () => {
    const { controller, db, task } = await makeEnv();
    const { cwd } = await controller.start(task.id);

    controller.input(task.id, "work\n");
    await waitFor(() => db.tasks.getById(task.id)?.status === "review", "task to reach review");

    const finished = await controller.finish(task.id);
    expect(finished.status).toBe("review");
    expect(await git(cwd as string, "log", "-1", "--pretty=%s")).toBe("feat: Fix login");
    expect(await git(cwd as string, "status", "--porcelain")).toBe("");
  });

  it("resumes the previous conversation when the task is reopened", async () => {
    const { controller, db, task, output } = await makeEnv();
    const first = await controller.start(task.id);
    controller.input(task.id, "one\n");
    await waitFor(
      () => db.tasks.getById(task.id)?.status !== "in_progress",
      "first session to end"
    );

    const second = await controller.start(task.id);
    expect(second.cwd).toBe(first.cwd);
    await waitFor(() => output().split("claude-args:").length > 2, "second claude start");
    expect(output().split("claude-args:").at(-1)).toContain("--continue");
    controller.stop(task.id);
  });

  it("can open a plain shell in the same workspace", async () => {
    const { controller, task, output } = await makeEnv();
    const state = await controller.start(task.id, { engine: "shell" });
    expect(state.engine).toBe("shell");

    controller.input(task.id, "pwd\n");
    await waitFor(
      () => output().includes((state.cwd as string).split("/").at(-1) as string),
      "shell prompt"
    );
    controller.stop(task.id);
  });

  it("reports a missing CLI instead of starting a broken session", async () => {
    const { controller, task } = await makeEnv();
    await expect(controller.start(task.id, { engine: "opencode" })).rejects.toBeInstanceOf(
      TerminalError
    );
  });

  it("keeps the agent alive when a client detaches and stops it on request", async () => {
    const { controller, db, task } = await makeEnv();
    await controller.start(task.id);
    expect((await controller.state(task.id)).live).toBe(true);

    expect(controller.stop(task.id)).toBe(true);
    await waitFor(
      () => db.runs.getLatestByTask(task.id)?.status === "cancelled",
      "run to be cancelled"
    );
  });

  it("removes a skill from the plugin when it is unselected", async () => {
    const { controller, task } = await makeEnv();
    const { cwd } = await controller.start(task.id, { skills: ["tdd"] });
    const skillFile = join(cwd as string, ".vibe-code", "plugin", "skills", "tdd", "SKILL.md");
    expect(existsSync(skillFile)).toBe(true);

    const state = await controller.setSkills(task.id, { skills: [] });
    expect(state.skills).toEqual(["vibe-code-orchestrator"]);
    expect(state.skillMode).toBe("manual");
    expect(existsSync(skillFile)).toBe(false);
    controller.stop(task.id);
  });

  it("applies the built-in orchestrator skill to every task and tells the agent how to reach the board", async () => {
    const { controller, task, output } = await makeEnv();
    const { cwd, applied } = await controller.start(task.id);
    expect(applied).toEqual([
      { name: "vibe-code-orchestrator", source: "always", reasons: ["built in"] },
    ]);
    const file = join(
      cwd as string,
      ".vibe-code",
      "plugin",
      "skills",
      "vibe-code-orchestrator",
      "SKILL.md"
    );
    expect(await Bun.file(file).text()).toContain("name: vibe-code-orchestrator");
    await waitFor(() => output().includes("claude-args:"), "claude to start");
    controller.stop(task.id);
  });

  it("picks skills from the task text and records why", async () => {
    const { controller, db, task } = await makeEnv();
    db.tasks.update(task.id, { title: "Add failing tests for login redirect" });

    const preview = await controller.previewSkills(task.id);
    expect(preview.mode).toBe("auto");
    expect(preview.applied.map((skill) => skill.name)).toEqual(["vibe-code-orchestrator", "tdd"]);

    const state = await controller.start(task.id);
    expect(state.skillMode).toBe("auto");
    const tdd = state.applied.find((skill) => skill.name === "tdd");
    expect(tdd?.source).toBe("auto");
    expect(tdd?.reasons[0]).toContain("tests");
    const stored = db.runs.getLatestByTask(task.id)?.matchedSkills;
    expect(JSON.parse(stored as unknown as string)).toEqual(["vibe-code-orchestrator", "tdd"]);
    controller.stop(task.id);
  });

  it("keeps a manual choice across sessions until the operator returns to auto", async () => {
    const { controller, db, task } = await makeEnv();
    db.tasks.update(task.id, { title: "Add failing tests for login redirect" });
    await controller.start(task.id, { skills: [] });
    controller.stop(task.id);
    await waitFor(
      () => db.runs.getLatestByTask(task.id)?.status === "cancelled",
      "first session to stop"
    );

    const again = await controller.start(task.id);
    expect(again.skillMode).toBe("manual");
    expect(again.skills).toEqual(["vibe-code-orchestrator"]);

    const back = await controller.setSkills(task.id, { mode: "auto" });
    expect(back.skillMode).toBe("auto");
    expect(back.skills).toEqual(["vibe-code-orchestrator", "tdd"]);
    controller.stop(task.id);
  });
});
