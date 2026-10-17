import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  type AppliedSkill,
  HARNESS_ENGINES,
  type HarnessEngine,
  type SessionSource,
  type SkillMode,
  type SkillPlan,
} from "@vibe-code/shared";
import { resolveOpencodeBinary } from "../agents/engines/opencode";

/**
 * Agent harness = the interactive CLI (Claude Code, OpenCode) that runs inside a
 * task's terminal. This module knows how to launch each one and where each one
 * looks for skills, so the rest of the app stays engine-agnostic.
 */

/** Where each harness discovers project-level skills (relative to the workspace). */
export const SKILL_DIRS: Record<HarnessEngine, string> = {
  "claude-code": ".claude/skills",
  opencode: ".opencode/skill",
};

/** Prompts up to this size go on the command line; bigger ones are read from a file. */
const INLINE_PROMPT_LIMIT = 4_000;
const BRIEF_PATH = ".vibe-code/TASK.md";
const MANIFEST_PATH = ".vibe-code/skills.json";
const PLAN_PATH = ".vibe-code/plan.json";
/** Claude Code plugin generated per workspace and loaded with `--plugin-dir`. */
export const PLUGIN_DIR = ".vibe-code/plugin";
const PLUGIN_NAME = "vibe-code";
const SAFE_DIR_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isHarnessEngine(value: string | null | undefined): value is HarnessEngine {
  return !!value && (HARNESS_ENGINES as readonly string[]).includes(value);
}

export interface HarnessTask {
  title: string;
  description?: string | null;
  goal?: string | null;
}

export function buildTaskBrief(task: HarnessTask): string {
  const parts = [`# ${task.title.trim()}`];
  if (task.goal?.trim()) parts.push(`## Goal\n${task.goal.trim()}`);
  if (task.description?.trim()) parts.push(task.description.trim());
  return `${parts.join("\n\n")}\n`;
}

export interface HarnessLaunchInput {
  engine: HarnessEngine;
  task: HarnessTask;
  model?: string | null;
  /** Continue the previous conversation of this workspace instead of starting a new one. */
  resume?: boolean;
  /** Absolute path of the generated agent plugin (Claude Code only). */
  pluginDir?: string | null;
  apiKeys?: { anthropic?: string; openai?: string; gemini?: string };
  env?: Record<string, string>;
}

export interface HarnessLaunch {
  argv: string[];
  env: Record<string, string>;
}

function initialPrompt(task: HarnessTask): string {
  const brief = buildTaskBrief(task).trim();
  if (brief.length <= INLINE_PROMPT_LIMIT) return brief;
  return `Complete the task described in ${BRIEF_PATH}. Read it first.`;
}

/** Placeholders that all mean "let the CLI choose a model". */
const MODEL_PLACEHOLDERS = new Set(["auto", "default", "auto-free"]);

/** Real model ids only — a placeholder must never be pinned into a config or a flag. */
function usableModel(model: string | null | undefined): string | null {
  const value = model?.trim();
  if (!value || MODEL_PLACEHOLDERS.has(value)) return null;
  return value;
}

/** True when `relativePath` is tracked by the repository at `workdir`. */
async function isTrackedByGit(workdir: string, relativePath: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["git", "ls-files", "--error-unmatch", relativePath], {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Argv that resumes a session started *outside* vibe-code in its own CLI. The app never
 * owns those processes' PTYs, so the Terminals view spawns a fresh, attached terminal in
 * the session's directory instead of taking over the running one.
 */
export function externalResumeArgv(source: SessionSource, sessionId: string): string[] {
  switch (source) {
    case "opencode":
      return [resolveOpencodeBinary(), "--session", sessionId];
    case "claude-code":
      return ["claude", "--resume", sessionId];
    case "antigravity":
      // The Antigravity CLI binary is `agy`; it resumes with `--conversation`.
      return ["agy", "--conversation", sessionId];
  }
}

export function buildHarnessLaunch(input: HarnessLaunchInput): HarnessLaunch {
  const env: Record<string, string> = { ...input.env };
  const model = usableModel(input.model);
  const prompt = initialPrompt(input.task);

  if (input.engine === "claude-code") {
    // Interactive mode keeps the operator's own `claude login`; an API key is only
    // forced when one was saved in Settings.
    if (input.apiKeys?.anthropic) env.ANTHROPIC_API_KEY = input.apiKeys.anthropic;
    const argv = ["claude"];
    if (model) argv.push("--model", model);
    if (input.pluginDir) argv.push("--plugin-dir", input.pluginDir);
    if (input.resume) argv.push("--continue");
    else argv.push(prompt);
    return { argv, env };
  }

  if (input.apiKeys?.anthropic) env.ANTHROPIC_API_KEY = input.apiKeys.anthropic;
  if (input.apiKeys?.openai) env.OPENAI_API_KEY = input.apiKeys.openai;
  if (input.apiKeys?.gemini) {
    env.GEMINI_API_KEY = input.apiKeys.gemini;
    env.GOOGLE_GENERATIVE_AI_API_KEY = input.apiKeys.gemini;
  }
  const argv = [resolveOpencodeBinary()];
  // The interactive TUI has no `--model` flag (only `opencode run` does); the chosen
  // model travels through the project config instead — see writeOpencodeModel().
  if (input.resume) argv.push("--continue");
  else argv.push("--prompt", prompt);
  return { argv, env };
}

/**
 * OpenCode's TUI rejects `--model` ("Unrecognized flag"), so the operator's model choice
 * is applied through the project config instead. Merges the key into the workspace's
 * `opencode.json`, keeping any other settings, and keeps the file out of git. A placeholder
 * or absent model clears only the key we own, so "auto" does not leave a stale pick behind.
 *
 * A repository that *tracks* its own `opencode.json` owns that file: it is left untouched,
 * because the git exclude below does not apply to tracked files and the pin would otherwise
 * be dragged into the task's commit and pull request.
 */
export async function writeOpencodeModel(workdir: string, model?: string | null): Promise<void> {
  const file = join(workdir, "opencode.json");
  const value = usableModel(model);

  let config: Record<string, unknown> = {};
  let existed = false;
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    existed = true;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    }
  } catch {
    // No config yet (or unreadable): start from a fresh object.
  }

  if (value) config.model = value;
  else delete config.model;

  // Nothing to pin and nothing to keep in sync: leave the workspace untouched.
  if (!existed && !value) return;
  if (await isTrackedByGit(workdir, "opencode.json")) return;

  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await excludeFromGit(workdir, ["opencode.json"]);
}

// ─── Workspace files ────────────────────────────────────────────────────────

export async function writeTaskBrief(workdir: string, task: HarnessTask): Promise<string> {
  const file = join(workdir, BRIEF_PATH);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buildTaskBrief(task), "utf8");
  return file;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

type Manifest = Partial<Record<HarnessEngine, string[]>>;

async function readManifest(workdir: string): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(join(workdir, MANIFEST_PATH), "utf8")) as Manifest;
  } catch {
    return {};
  }
}

async function writeManifest(workdir: string, manifest: Manifest): Promise<void> {
  const file = join(workdir, MANIFEST_PATH);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(manifest, null, 2), "utf8");
}

/** Resolve the git "info/exclude" file of a (possibly linked) worktree. */
async function resolveExcludeFile(workdir: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--git-path", "info/exclude"], {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = (await new Response(proc.stdout).text()).trim();
    if ((await proc.exited) !== 0 || !out) return null;
    return isAbsolute(out) ? out : resolve(workdir, out);
  } catch {
    return null;
  }
}

/** Keep injected harness files out of `git status`, without touching tracked files. */
export async function excludeFromGit(workdir: string, entries: string[]): Promise<void> {
  const file = await resolveExcludeFile(workdir);
  if (!file || entries.length === 0) return;
  try {
    await mkdir(dirname(file), { recursive: true });
    const current = await readFile(file, "utf8").catch(() => "");
    const known = new Set(current.split("\n").map((line) => line.trim()));
    const missing = entries.filter((entry) => !known.has(entry));
    if (missing.length === 0) return;
    const prefix = current.length === 0 || current.endsWith("\n") ? "" : "\n";
    await writeFile(file, `${current}${prefix}${missing.join("\n")}\n`, "utf8");
  } catch {
    // Best effort: a failure here must never block the session.
  }
}

export interface InjectableSkill {
  name: string;
  /** Absolute path to the skill's SKILL.md. */
  filePath: string;
}

export interface InjectResult {
  injected: string[];
  /** Requested but not installed (unknown name or missing SKILL.md). */
  missing: string[];
  /** Already provided by the repository itself — never overwritten. */
  skipped: string[];
}

function skillFolder(skill: InjectableSkill): string {
  return basename(dirname(skill.filePath));
}

/**
 * Make `wanted` the exact set of vibe-code-managed skills in the workspace:
 * copies the missing ones in and removes the ones that were previously injected
 * but are no longer wanted. Skills that the repository itself tracks are left alone.
 */
export async function syncSkills(
  workdir: string,
  engine: HarnessEngine,
  wanted: string[],
  catalog: InjectableSkill[]
): Promise<InjectResult> {
  const root = join(workdir, SKILL_DIRS[engine]);
  const manifest = await readManifest(workdir);
  const previous = new Set(manifest[engine] ?? []);
  const byName = new Map(catalog.map((skill) => [skill.name, skill]));
  const result: InjectResult = { injected: [], missing: [], skipped: [] };
  const desiredFolders = new Set<string>();
  const managedFolders = new Set<string>();

  for (const name of wanted) {
    const skill = byName.get(name);
    if (!skill || !(await exists(skill.filePath))) {
      result.missing.push(name);
      continue;
    }
    const folder = skillFolder(skill);
    if (!SAFE_DIR_NAME.test(folder)) {
      result.missing.push(name);
      continue;
    }
    desiredFolders.add(folder);
    const target = join(root, folder);
    if (!previous.has(folder) && (await exists(target))) {
      result.skipped.push(name);
      continue;
    }
    await rm(target, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    await cp(dirname(skill.filePath), target, { recursive: true });
    managedFolders.add(folder);
    result.injected.push(name);
  }

  for (const folder of previous) {
    if (desiredFolders.has(folder) || !SAFE_DIR_NAME.test(folder)) continue;
    await rm(join(root, folder), { recursive: true, force: true });
  }

  const managed = [...managedFolders];
  await writeManifest(workdir, { ...manifest, [engine]: managed });
  await excludeFromGit(workdir, [
    "/.vibe-code/",
    ...managed.map((folder) => `/${SKILL_DIRS[engine]}/${folder}/`),
  ]);
  return result;
}

/** Names of skills currently injected by vibe-code into this workspace. */
export async function listManagedSkills(
  workdir: string,
  engine: HarnessEngine,
  catalog: InjectableSkill[]
): Promise<string[]> {
  const manifest = await readManifest(workdir);
  const folders = new Set(manifest[engine] ?? []);
  return catalog.filter((skill) => folders.has(skillFolder(skill))).map((skill) => skill.name);
}

// ─── Agent plugin ───────────────────────────────────────────────────────────

export interface PluginInstall extends InjectResult {
  /** Directory to pass to `claude --plugin-dir`; null when nothing needs loading. */
  pluginDir: string | null;
}

/** Write the skills of a task as a session-only Claude Code plugin. */
async function buildClaudePlugin(
  workdir: string,
  wanted: string[],
  catalog: InjectableSkill[]
): Promise<PluginInstall> {
  const root = join(workdir, PLUGIN_DIR);
  const byName = new Map(catalog.map((skill) => [skill.name, skill]));
  const result: PluginInstall = { injected: [], missing: [], skipped: [], pluginDir: null };
  await rm(root, { recursive: true, force: true });

  const folders: Array<{ name: string; folder: string; source: string }> = [];
  for (const name of wanted) {
    const skill = byName.get(name);
    const folder = skill ? skillFolder(skill) : "";
    if (!skill || !SAFE_DIR_NAME.test(folder) || !(await exists(skill.filePath))) {
      result.missing.push(name);
      continue;
    }
    folders.push({ name, folder, source: dirname(skill.filePath) });
  }

  if (folders.length > 0) {
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify(
        {
          name: PLUGIN_NAME,
          version: "1.0.0",
          description: "Skills vibe-code selected for this task",
          author: { name: "vibe-code" },
        },
        null,
        2
      ),
      "utf8"
    );
    for (const entry of folders) {
      await cp(entry.source, join(root, "skills", entry.folder), { recursive: true });
      result.injected.push(entry.name);
    }
    result.pluginDir = root;
  }

  await excludeFromGit(workdir, ["/.vibe-code/"]);
  return result;
}

/**
 * Apply the chosen skills the way each harness consumes plugins: Claude Code gets a
 * session-only plugin (nothing lands in `.claude/`), OpenCode — which has no plugin
 * directory flag — gets project skills under `.opencode/skill`. Both stay out of git.
 */
export async function installAgentPlugin(
  workdir: string,
  engine: HarnessEngine,
  wanted: string[],
  catalog: InjectableSkill[]
): Promise<PluginInstall> {
  if (engine === "claude-code") {
    // Skills copied into `.claude/skills` by an earlier version are now plugin content.
    await syncSkills(workdir, "claude-code", [], catalog);
    return buildClaudePlugin(workdir, wanted, catalog);
  }
  const result = await syncSkills(workdir, engine, wanted, catalog);
  return { ...result, pluginDir: null };
}

interface StoredPlan {
  mode: SkillMode;
  applied: AppliedSkill[];
}

/** The plan applied to a workspace, so reasons and the manual/auto choice survive restarts. */
export async function readSkillPlan(workdir: string): Promise<SkillPlan | null> {
  try {
    const stored = JSON.parse(await readFile(join(workdir, PLAN_PATH), "utf8")) as StoredPlan;
    if (stored.mode !== "auto" && stored.mode !== "manual") return null;
    if (!Array.isArray(stored.applied)) return null;
    const applied = stored.applied.filter(
      (entry): entry is AppliedSkill =>
        !!entry && typeof entry.name === "string" && Array.isArray(entry.reasons)
    );
    return { mode: stored.mode, applied };
  } catch {
    return null;
  }
}

export async function writeSkillPlan(workdir: string, plan: SkillPlan): Promise<void> {
  const file = join(workdir, PLAN_PATH);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(plan, null, 2), "utf8");
}
