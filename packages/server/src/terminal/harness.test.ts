import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHarnessLaunch,
  buildTaskBrief,
  type InjectableSkill,
  isHarnessEngine,
  listManagedSkills,
  SKILL_DIRS,
  syncSkills,
  writeTaskBrief,
} from "./harness";

const dirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

async function makeRepoWithWorktree(): Promise<string> {
  const root = await tempDir("harness-repo-");
  await git(root, "init", "-q", "--initial-branch=main");
  await git(root, "config", "user.email", "t@t.t");
  await git(root, "config", "user.name", "t");
  await writeFile(join(root, "README.md"), "# t\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-qm", "init");
  const wt = join(await tempDir("harness-wt-"), "wt");
  await git(root, "worktree", "add", "-q", "-b", "task/x", wt);
  return wt;
}

async function makeCatalog(): Promise<InjectableSkill[]> {
  const base = await tempDir("harness-skills-");
  const catalog: InjectableSkill[] = [];
  for (const name of ["tdd", "review"]) {
    const dir = join(base, "skills", name);
    await mkdir(join(dir, "scripts"), { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} skill\n---\nbody`
    );
    await writeFile(join(dir, "scripts", "run.sh"), "echo hi");
    catalog.push({ name, filePath: join(dir, "SKILL.md") });
  }
  return catalog;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("buildHarnessLaunch", () => {
  const task = { title: "Fix login", description: "Redirect loops on /login" };

  it("starts Claude Code interactively with the task as the first prompt", () => {
    const { argv, env } = buildHarnessLaunch({ engine: "claude-code", task, model: "sonnet" });
    expect(argv[0]).toBe("claude");
    expect(argv).not.toContain("-p");
    expect(argv).not.toContain("--print");
    expect(argv.slice(1, 3)).toEqual(["--model", "sonnet"]);
    expect(argv.at(-1)).toContain("# Fix login");
    expect(argv.at(-1)).toContain("Redirect loops on /login");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("starts OpenCode's TUI (no `run`) with --prompt and --model", () => {
    const { argv } = buildHarnessLaunch({
      engine: "opencode",
      task,
      model: "anthropic/claude-sonnet-4",
    });
    expect(argv[0]).toContain("opencode");
    expect(argv).not.toContain("run");
    expect(argv).toContain("--prompt");
    expect(argv[argv.indexOf("--model") + 1]).toBe("anthropic/claude-sonnet-4");
  });

  it("resumes the previous conversation instead of repeating the prompt", () => {
    const claude = buildHarnessLaunch({ engine: "claude-code", task, resume: true }).argv;
    expect(claude).toContain("--continue");
    expect(claude.join(" ")).not.toContain("Fix login");

    const opencode = buildHarnessLaunch({ engine: "opencode", task, resume: true }).argv;
    expect(opencode).toContain("--continue");
    expect(opencode).not.toContain("--prompt");
  });

  it("ignores placeholder models", () => {
    for (const model of ["auto", "default", "", "  ", null, undefined]) {
      expect(buildHarnessLaunch({ engine: "claude-code", task, model }).argv).not.toContain(
        "--model"
      );
    }
  });

  it("points at the brief file when the prompt is too long for the command line", () => {
    const long = { title: "Big", description: "x".repeat(10_000) };
    const prompt = buildHarnessLaunch({ engine: "claude-code", task: long }).argv.at(-1) ?? "";
    expect(prompt.length).toBeLessThan(200);
    expect(prompt).toContain(".vibe-code/TASK.md");
  });

  it("only forwards API keys that were configured", () => {
    const { env } = buildHarnessLaunch({
      engine: "opencode",
      task,
      apiKeys: { anthropic: "a", openai: "o", gemini: "g" },
      env: { VIBE_CODE_TASK_ID: "t1" },
    });
    expect(env).toMatchObject({
      ANTHROPIC_API_KEY: "a",
      OPENAI_API_KEY: "o",
      GEMINI_API_KEY: "g",
      VIBE_CODE_TASK_ID: "t1",
    });
    expect(buildHarnessLaunch({ engine: "opencode", task }).env.OPENAI_API_KEY).toBeUndefined();
  });

  it("knows which engines are harnesses", () => {
    expect(isHarnessEngine("claude-code")).toBe(true);
    expect(isHarnessEngine("opencode")).toBe(true);
    expect(isHarnessEngine("gemini")).toBe(false);
    expect(isHarnessEngine(null)).toBe(false);
  });
});

describe("task brief", () => {
  it("renders title, goal and description", () => {
    expect(buildTaskBrief({ title: " T ", goal: "G", description: "D" })).toBe(
      "# T\n\n## Goal\nG\n\nD\n"
    );
  });

  it("is written under .vibe-code/", async () => {
    const dir = await tempDir("harness-brief-");
    const file = await writeTaskBrief(dir, { title: "T", description: "D" });
    expect(file).toBe(join(dir, ".vibe-code", "TASK.md"));
    expect(await readFile(file, "utf8")).toContain("# T");
  });
});

describe("syncSkills", () => {
  it("copies whole skill folders into the engine's skill dir and hides them from git", async () => {
    const wt = await makeRepoWithWorktree();
    const catalog = await makeCatalog();

    const result = await syncSkills(wt, "claude-code", ["tdd"], catalog);

    expect(result.injected).toEqual(["tdd"]);
    expect(existsSync(join(wt, SKILL_DIRS["claude-code"], "tdd", "SKILL.md"))).toBe(true);
    expect(existsSync(join(wt, SKILL_DIRS["claude-code"], "tdd", "scripts", "run.sh"))).toBe(true);
    expect((await git(wt, "status", "--porcelain")).trim()).toBe("");
  });

  it("uses each harness's own skill directory", async () => {
    const wt = await makeRepoWithWorktree();
    const catalog = await makeCatalog();

    await syncSkills(wt, "opencode", ["review"], catalog);

    expect(existsSync(join(wt, ".opencode", "skill", "review", "SKILL.md"))).toBe(true);
    expect(existsSync(join(wt, ".claude"))).toBe(false);
  });

  it("removes skills that are no longer wanted, and only those it injected", async () => {
    const wt = await makeRepoWithWorktree();
    const catalog = await makeCatalog();
    await syncSkills(wt, "claude-code", ["tdd", "review"], catalog);
    const own = join(wt, ".claude", "skills", "mine");
    await mkdir(own, { recursive: true });
    await writeFile(join(own, "SKILL.md"), "mine");

    await syncSkills(wt, "claude-code", ["review"], catalog);

    expect(existsSync(join(wt, ".claude", "skills", "tdd"))).toBe(false);
    expect(existsSync(join(wt, ".claude", "skills", "review"))).toBe(true);
    expect(existsSync(join(own, "SKILL.md"))).toBe(true);
    expect(await listManagedSkills(wt, "claude-code", catalog)).toEqual(["review"]);
  });

  it("never overwrites a skill the repository already tracks", async () => {
    const wt = await makeRepoWithWorktree();
    const catalog = await makeCatalog();
    const tracked = join(wt, ".claude", "skills", "tdd");
    await mkdir(tracked, { recursive: true });
    await writeFile(join(tracked, "SKILL.md"), "repo version");

    const result = await syncSkills(wt, "claude-code", ["tdd"], catalog);

    expect(result.skipped).toEqual(["tdd"]);
    expect(await readFile(join(tracked, "SKILL.md"), "utf8")).toBe("repo version");
    await syncSkills(wt, "claude-code", [], catalog);
    expect(await readFile(join(tracked, "SKILL.md"), "utf8")).toBe("repo version");
  });

  it("reports unknown skills instead of failing", async () => {
    const wt = await makeRepoWithWorktree();
    const result = await syncSkills(wt, "claude-code", ["ghost"], await makeCatalog());
    expect(result).toEqual({ injected: [], missing: ["ghost"], skipped: [] });
  });
});
