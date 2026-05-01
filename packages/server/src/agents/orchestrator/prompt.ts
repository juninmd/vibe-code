import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillPayload, SkillPayloadItem, Task } from "@vibe-code/shared";
import type { SkillsLoader } from "../../skills/loader";
import { matchSkillsForTask } from "../../skills/matcher";
import { RepoSkillsLoader } from "../../skills/repo-loader";

export interface BuildContextResult {
  prompt: string;
  skills: SkillPayload;
}

export interface ParentTaskInfo {
  id: string;
  title: string;
  description: string;
  parentId?: string | null;
}

interface ProjectContext {
  mainLanguages: string[];
  frameworks: string[];
  agentInstructions: string | null;
}

async function detectProjectContext(workdir: string): Promise<ProjectContext> {
  const ctx: ProjectContext = {
    mainLanguages: [],
    frameworks: [],
    agentInstructions: null,
  };

  try {
    const pkgRaw = await readFile(join(workdir, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);

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
  } catch {
    // Package metadata is optional. Prompt remains generic when unavailable.
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

export async function buildContextAsync(
  task: Task,
  workdir: string,
  skillsLoader?: SkillsLoader,
  repoId?: string,
  dbFindingsLoader?: (repoId: string) => { persona: string; severity: string; content: string }[],
  parentTaskLoader?: (parentId: string) => Promise<ParentTaskInfo | null>
): Promise<BuildContextResult> {
  const ctx = await detectProjectContext(workdir);

  const emptyPayload: SkillPayload = {
    rules: [],
    skills: [],
    workflow: null,
    agents: [],
    projectInstructions: ctx.agentInstructions,
  };

  let skillsSection = "";
  let skillPayload: SkillPayload = { ...emptyPayload };

  if (skillsLoader) {
    try {
      const globalIndex = await skillsLoader.load();

      // M2: Merge per-repo skills from .vibe-code/ in worktree
      const repoLoader = new RepoSkillsLoader(workdir);
      const repoIndex = await repoLoader.load();
      const mergedIndex = {
        skills: [...globalIndex.skills, ...repoIndex.skills],
        rules: [...globalIndex.rules, ...repoIndex.rules],
        agents: [...globalIndex.agents, ...repoIndex.agents],
        workflows: [...globalIndex.workflows, ...repoIndex.workflows],
      };

      const matched = await matchSkillsForTask(
        mergedIndex,
        task.title,
        task.description ?? "",
        workdir
      );

      const parts: string[] = [];

      // Load full content for matched rules
      const rulePayloads: SkillPayloadItem[] = [];
      if (matched.rules.length > 0) {
        parts.push("### Coding Standards (auto-matched)\n");
        for (const rule of matched.rules) {
          parts.push(`- **${rule.name}**: ${rule.description}`);
          const content = await safeLoadContent(skillsLoader, repoLoader, rule.filePath);
          rulePayloads.push({ name: rule.name, description: rule.description, content });
        }
      }

      // Load full content for matched skills
      const skillPayloads: SkillPayloadItem[] = [];
      if (matched.skills.length > 0) {
        parts.push("\n### Applicable Skills (auto-matched)\n");
        for (const skill of matched.skills) {
          parts.push(`- **${skill.name}**: ${skill.description}`);
          const content = await safeLoadContent(skillsLoader, repoLoader, skill.filePath);
          skillPayloads.push({ name: skill.name, description: skill.description, content });
        }
      }

      // Workflow
      let workflowPayload: SkillPayloadItem | null = null;
      if (matched.workflow) {
        parts.push(`\n### Workflow: ${matched.workflow.name}\n${matched.workflow.description}`);
        const content = await safeLoadContent(skillsLoader, repoLoader, matched.workflow.filePath);
        workflowPayload = {
          name: matched.workflow.name,
          description: matched.workflow.description,
          content,
        };
      }

      // M6: Agent persona injection
      const agentPayloads: SkillPayloadItem[] = [];
      if (matched.agents.length > 0) {
        parts.push("\n### Agent Persona (auto-matched)\n");
        for (const agent of matched.agents) {
          const content = await safeLoadContent(skillsLoader, repoLoader, agent.filePath);
          parts.push(`- **${agent.name}**: ${agent.description}`);
          agentPayloads.push({ name: agent.name, description: agent.description, content });
        }
      }

      if (parts.length > 0) {
        skillsSection = `## Organizational Standards\n${parts.join("\n")}`;
      }

      skillPayload = {
        rules: rulePayloads,
        skills: skillPayloads,
        workflow: workflowPayload,
        agents: agentPayloads,
        projectInstructions: ctx.agentInstructions,
      };
    } catch {
      // Skills loading failure is non-fatal — proceed without injection
    }
  }

  // M4: Inject lessons learned from previous review findings
  let lessonsSection = "";
  if (repoId && dbFindingsLoader) {
    try {
      const findings = dbFindingsLoader(repoId);
      if (findings.length > 0) {
        const MAX_LESSONS_CHARS = 2000;
        let chars = 0;
        const lines: string[] = [];
        for (const f of findings) {
          const line = `- [${f.persona}/${f.severity}] ${f.content}`;
          if (chars + line.length > MAX_LESSONS_CHARS) break;
          chars += line.length;
          lines.push(line);
        }
        if (lines.length > 0) {
          lessonsSection = `## Lessons Learned (from previous reviews)\n${lines.join("\n")}`;
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // M1: Goal Ancestry (Paperclip-inspired)
  let ancestrySection = "";
  if (task.parentTaskId && parentTaskLoader) {
    try {
      const ancestry: ParentTaskInfo[] = [];
      let currentId: string | null = task.parentTaskId;
      while (currentId && ancestry.length < 5) {
        const p = await parentTaskLoader(currentId);
        if (!p) break;
        ancestry.push(p);
        currentId = p.parentId ?? null;
      }

      if (ancestry.length > 0) {
        const lines = ancestry.map(
          (p) => `- **Parent Task**: ${p.title}\n  ${p.description.slice(0, 500)}`
        );
        ancestrySection = `## Goal Ancestry (The "Why")\n${lines.join("\n")}`;
      }
    } catch {
      // ignore
    }
  }

  const prompt = assemblePrompt(task, ctx, skillsSection, lessonsSection, ancestrySection);
  return { prompt, skills: skillPayload };
}

export async function buildPromptAsync(
  task: Task,
  workdir: string,
  skillsLoader?: SkillsLoader
): Promise<string> {
  const result = await buildContextAsync(task, workdir, skillsLoader);
  return result.prompt;
}

async function safeLoadContent(
  globalLoader: SkillsLoader,
  repoLoader: RepoSkillsLoader,
  filePath: string
): Promise<string> {
  try {
    return await globalLoader.getFileContent(filePath);
  } catch {
    try {
      return await repoLoader.getFileContent(filePath);
    } catch {
      return "";
    }
  }
}

export function buildPrompt(task: Task): string {
  // Sync fallback — used when workdir is not available
  return assemblePrompt(task, {
    mainLanguages: [],
    frameworks: [],
    agentInstructions: null,
  });
}

function assemblePrompt(
  task: Task,
  ctx: ProjectContext,
  skillsSection = "",
  lessonsSection = "",
  ancestrySection = ""
): string {
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

  // ── Goal Ancestry (Paperclip-inspired) ─────────────────────────────────────
  if (ancestrySection) {
    sections.push(ancestrySection);
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

  // ── Organizational standards (skills/rules from ~/.agents) ─────────────────
  if (skillsSection) {
    sections.push(skillsSection);
  }

  // ── Lessons learned from previous reviews ──────────────────────────────────
  if (lessonsSection) {
    sections.push(lessonsSection);
  }

  // ── Execution instructions ─────────────────────────────────────────────────
  const execLines: string[] = [
    "Implement ALL requirements listed above exactly as described.",
    "Create, edit, or delete files as needed — including full file content when creating new files.",
    "Do NOT ask clarifying questions — make reasonable decisions and proceed immediately.",
    "There is no user available to answer questions. You must complete the task autonomously.",
    "Do NOT enter Plan Mode and do NOT call `enter_plan_mode`.",
    "",
    "**Task Delegation (Active Delegation):**",
    "If the task is too large or requires a different expertise, you can delegate sub-tasks to other agents.",
    "Use the `vibe-task` CLI command to create new tasks in this repository.",
    'Example: `vibe-task create --title "Refactor auth" --description "Move auth to a separate module"`',
    "Tasks created this way will automatically be linked as sub-tasks of this one.",
    "",
    "**Governance Gates (Manual Approval):**",
    "For sensitive actions like pushing to main, deleting production data, or spending tokens on large sub-tasks, you MUST request human approval.",
    "Use the `vibe-approve` CLI command. It will pause your execution until a human approves it in the UI.",
    'Example: `vibe-approve --message "I want to push changes to the main branch" --command "git push origin main"`',
    "",
    "**Before finishing:**",
    "- Discover and use the repository's own CLI/workflow for validation (read scripts, Makefile/Taskfile/justfile, README, and project docs).",
    "- Always run lint, test, and build via the project's native commands.",
    "- If any validation fails, fix the issues and re-run validation until lint, test, and build all pass.",
    "- Include in your final summary the exact commands you executed for lint/test/build.",
  ];

  execLines.push(
    "",
    "**Repository safety boundaries (mandatory):**",
    "- You may modify files only inside the current task worktree/repository.",
    "- Do NOT read, edit, or run commands against any other local repository or parent/sibling directories.",
    "- Never delete remote repositories (GitHub/GitLab).",
    "",
    "**Code quality rules:**",
    "- Do NOT rely on `pgrep`. Prefer `ps`, `grep`, `lsof`, or `/proc`-based checks when process inspection is needed.",
    "- Avoid tool name `run_shell_command` in this environment (it may be policy-blocked); use allowed terminal/command tools instead.",
    "- If a tool is denied by policy, do not loop on the same tool call; switch to an allowed alternative and continue.",
    "- Use non-interactive commands only (pass `--yes`, `--force`, `--template`, or equivalent flags when scaffolding projects).",
    "- Add or update automated tests for every changed behavior. If no test setup exists, create minimal runnable tests.",
    "- For net-new frontend projects, use React + Vite (prefer TypeScript) instead of plain HTML/JS.",
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
