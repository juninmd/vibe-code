import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Task } from "@vibe-code/shared";

interface ProjectContext {
  hasPackageJson: boolean;
  packageManager: string | null;
  mainLanguages: string[];
  testCommand: string | null;
  buildCommand: string | null;
  lintCommand: string | null;
  frameworks: string[];
  agentInstructions: string | null;
}

async function detectProjectContext(workdir: string): Promise<ProjectContext> {
  const ctx: ProjectContext = {
    hasPackageJson: false,
    packageManager: null,
    mainLanguages: [],
    testCommand: null,
    buildCommand: null,
    lintCommand: null,
    frameworks: [],
    agentInstructions: null,
  };

  try {
    const pkgRaw = await readFile(join(workdir, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);
    ctx.hasPackageJson = true;

    const scripts = pkg.scripts ?? {};
    ctx.testCommand =
      scripts.test && !scripts.test.includes("no test") ? `${detectPm(workdir)} run test` : null;
    ctx.buildCommand = scripts.build ? `${detectPm(workdir)} run build` : null;
    ctx.lintCommand =
      (scripts.lint ?? scripts["lint:fix"] ?? scripts.check)
        ? `${detectPm(workdir)} run lint`
        : null;

    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    if (deps.react) ctx.frameworks.push("React");
    if (deps.next) ctx.frameworks.push("Next.js");
    if (deps.vue) ctx.frameworks.push("Vue");
    if (deps.svelte) ctx.frameworks.push("Svelte");
    if (deps.express || deps.fastify || deps.hono) ctx.frameworks.push("Node.js API");
    if (deps.typescript || deps["@types/node"]) ctx.mainLanguages.push("TypeScript");
    else ctx.mainLanguages.push("JavaScript");
    if (deps.tailwindcss) ctx.frameworks.push("TailwindCSS");
    if (deps.prisma) ctx.frameworks.push("Prisma");

    const pmFiles = [
      ["bun.lock", "bun"],
      ["bun.lockb", "bun"],
      ["pnpm-lock.yaml", "pnpm"],
      ["yarn.lock", "yarn"],
    ];
    for (const [file, pm] of pmFiles) {
      try {
        await readFile(join(workdir, file));
        ctx.packageManager = pm;
        break;
      } catch {}
    }
    if (!ctx.packageManager) ctx.packageManager = "npm";
  } catch {
    // No package.json — could be Python, Go, Rust, etc.
    try {
      await readFile(join(workdir, "requirements.txt"));
      ctx.mainLanguages.push("Python");
      ctx.testCommand = "pytest";
    } catch {}
    try {
      await readFile(join(workdir, "go.mod"));
      ctx.mainLanguages.push("Go");
      ctx.testCommand = "go test ./...";
      ctx.buildCommand = "go build ./...";
    } catch {}
    try {
      await readFile(join(workdir, "Cargo.toml"));
      ctx.mainLanguages.push("Rust");
      ctx.testCommand = "cargo test";
      ctx.buildCommand = "cargo build";
    } catch {}
  }

  // Read AGENTS.md or CLAUDE.md for project-specific instructions
  for (const file of ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md"]) {
    try {
      const content = await readFile(join(workdir, file), "utf8");
      if (content.trim()) {
        ctx.agentInstructions = content.slice(0, 3000); // Cap at 3k chars
        break;
      }
    } catch {}
  }

  return ctx;
}

function detectPm(_workdir: string): string {
  // Quick sync check — we'll refine async above
  return "bun";
}

export async function buildPromptAsync(task: Task, workdir: string): Promise<string> {
  const ctx = await detectProjectContext(workdir);
  return assemblePrompt(task, ctx);
}

export function buildPrompt(task: Task): string {
  // Sync fallback — used when workdir is not available
  return assemblePrompt(task, {
    hasPackageJson: false,
    packageManager: null,
    mainLanguages: [],
    testCommand: null,
    buildCommand: null,
    lintCommand: null,
    frameworks: [],
    agentInstructions: null,
  });
}

function assemblePrompt(task: Task, ctx: ProjectContext): string {
  const sections: string[] = [];

  // ── CRITICAL directive — must appear first to prevent interactive mode ──────
  sections.push(
    "**IMPORTANT: This is a fully automated, non-interactive session. " +
      "Do NOT ask the user any questions. " +
      "Do NOT wait for confirmation. " +
      "Start implementing immediately using the requirements below. " +
      "Make all decisions yourself and proceed to completion.**"
  );

  // ── Task definition ────────────────────────────────────────────────────────
  sections.push(`# Task: ${task.title}`);

  if (task.description?.trim()) {
    sections.push(`## Requirements\n${task.description.trim()}`);
  }

  // ── Project context (when detected) ───────────────────────────────────────
  if (ctx.agentInstructions) {
    sections.push(`## Project Instructions\n${ctx.agentInstructions}`);
  }

  if (ctx.frameworks.length > 0 || ctx.mainLanguages.length > 0) {
    const stackLine = [ctx.mainLanguages.join(", "), ctx.frameworks.join(", ")]
      .filter(Boolean)
      .join(" · ");
    sections.push(
      `## Project Stack\n${stackLine}\n\nFollow the conventions already in place. ` +
        "Inspect existing files before creating new ones. Match the style of nearby code."
    );
  }

  // ── Execution instructions ─────────────────────────────────────────────────
  const execLines: string[] = [
    "Implement ALL requirements listed above exactly as described.",
    "Create, edit, or delete files as needed — including full file content when creating new files.",
    "Do NOT ask clarifying questions — make reasonable decisions and proceed immediately.",
    "There is no user available to answer questions. You must complete the task autonomously.",
    "",
    "**Before finishing:**",
  ];

  if (ctx.buildCommand) {
    execLines.push(`- Run \`${ctx.buildCommand}\` and fix any build errors before finishing.`);
  }
  if (ctx.lintCommand) {
    execLines.push(`- Run \`${ctx.lintCommand}\` and fix lint errors (not warnings).`);
  }
  if (ctx.testCommand) {
    execLines.push(`- Run \`${ctx.testCommand}\` and ensure existing tests still pass.`);
  }

  execLines.push(
    "",
    "**Repository safety boundaries (mandatory):**",
    "- You may modify files only inside the current task worktree/repository.",
    "- Do NOT read, edit, or run commands against any other local repository or parent/sibling directories.",
    "- Never delete remote repositories (GitHub/GitLab).",
    "",
    "**Code quality rules:**",
    "- No hardcoded secrets, credentials or API keys — use environment variables.",
    "- **CRITICAL: Respect `.gitignore`. Do NOT create, modify, or read files that are ignored by git.**",
    "- Validate user inputs. Handle errors gracefully with meaningful messages.",
    "- Keep functions small and focused (single responsibility).",
    "- Add comments only where logic is non-obvious.",
    "",
    "**Git:**",
    "- Stage all changed files with `git add -A` when done.",
    "- Use conventional commit format: `feat: <description>` or `fix: <description>`.",
    "- One cohesive commit covering all changes."
  );

  sections.push(`## Instructions\n${execLines.join("\n")}`);

  return sections.join("\n\n");
}
