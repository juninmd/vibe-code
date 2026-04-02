/**
 * Reviewer engine — runs `claude --print` with a specialized persona prompt
 * and the git diff to review code changes before PR creation.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type ReviewPersona = "frontend" | "backend" | "security" | "quality";

interface ReviewEvent {
  persona: ReviewPersona;
  content: string;
  hasBlocker: boolean;
}

const PERSONA_PROMPTS: Record<ReviewPersona, string> = {
  frontend: `You are a senior React/TypeScript frontend engineer reviewing a pull request diff.
Review ONLY the code changes shown in the diff below.
Focus on: React/JSX correctness, hook patterns, accessibility (ARIA, keyboard nav), rendering performance, TypeScript type safety, and CSS/styling issues.
Format each issue as one of:
  BLOCKER: <description>
  WARNING: <description>
  INFO: <description>
If there are no issues, write: LGTM
Be concise, specific, and actionable. Reference file names and line numbers when possible.`,

  backend: `You are a senior backend engineer reviewing a pull request diff.
Review ONLY the code changes shown in the diff below.
Focus on: API handler correctness, database query safety (SQL injection, N+1), error handling completeness, WebSocket event integrity, input validation, and type safety.
Format each issue as one of:
  BLOCKER: <description>
  WARNING: <description>
  INFO: <description>
If there are no issues, write: LGTM
Be concise, specific, and actionable. Reference file names and line numbers when possible.`,

  security: `You are a security engineer reviewing a pull request diff.
Review ONLY the code changes shown in the diff below.
Focus on: OWASP Top 10 (injection, XSS, broken auth, sensitive data exposure), hardcoded secrets or credentials, command injection, path traversal, insecure deserialization, broken access control, and vulnerable dependency usage.
Format each issue as one of:
  BLOCKER: <description>  (vulnerabilities, exposed secrets — MUST be fixed before merge)
  WARNING: <description>  (security weaknesses worth addressing)
  INFO: <description>
If there are no issues, write: LGTM
Be concise, specific, and actionable. Reference exact file names and patterns found.`,

  quality: `You are a code quality engineer reviewing a pull request diff.
Review ONLY the code changes shown in the diff below.
Focus on: missing test coverage for changed logic, high cyclomatic complexity, code duplication, unclear variable/function names, overly large functions, missing error handling, and maintainability concerns.
Format each issue as one of:
  BLOCKER: <description>  (critical quality issues blocking merge)
  WARNING: <description>
  INFO: <description>
If there are no issues, write: LGTM
Be concise, specific, and actionable. Reference file names when relevant.`,
};

const PERSONA_LABELS: Record<ReviewPersona, string> = {
  frontend: "Frontend",
  backend: "Backend",
  security: "Security",
  quality: "Quality",
};

/** Get the git diff for all changes on the current branch vs the base branch. */
async function getWorktreeDiff(worktreePath: string, defaultBranch: string): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "diff", `${defaultBranch}...HEAD`], {
      cwd: worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    const diff = await new Response(proc.stdout).text();
    // Truncate to avoid token limits — 12k chars covers most PRs
    return diff.length > 12_000
      ? `${diff.slice(0, 12_000)}\n\n[diff truncated at 12,000 chars]`
      : diff;
  } catch {
    return "[could not retrieve diff]";
  }
}

/**
 * Run a single persona review using `claude --print`.
 * Returns a stream of text lines and whether any BLOCKER was found.
 */
export async function runPersonaReview(opts: {
  persona: ReviewPersona;
  worktreePath: string;
  taskTitle: string;
  taskDescription: string;
  defaultBranch: string;
}): Promise<ReviewEvent> {
  const { persona, worktreePath, taskTitle, taskDescription, defaultBranch } = opts;

  const diff = await getWorktreeDiff(worktreePath, defaultBranch);
  const label = PERSONA_LABELS[persona];

  const prompt = [
    PERSONA_PROMPTS[persona],
    "",
    `## Task Context`,
    `Title: ${taskTitle}`,
    taskDescription ? `Description: ${taskDescription}` : "",
    "",
    `## Git Diff`,
    "```diff",
    diff,
    "```",
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const lines: string[] = [];
  let hasBlocker = false;

  // Write prompt to a temp file to avoid it appearing in `ps` output and
  // to sidestep OS argument length limits on large diffs.
  const tmpDir = await mkdtemp(join(tmpdir(), "vibe-review-"));
  const promptFile = join(tmpDir, "prompt.md");

  try {
    await writeFile(promptFile, prompt, "utf8");

    const proc = Bun.spawn(["claude", "--print", "-p", `@${promptFile}`], {
      cwd: worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        if (line.trim()) {
          lines.push(line);
          if (line.startsWith("BLOCKER:")) hasBlocker = true;
        }
      }
    }
    if (buffer.trim()) {
      lines.push(buffer);
      if (buffer.startsWith("BLOCKER:")) hasBlocker = true;
    }

    await proc.exited;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`[reviewer] ${label} review failed: ${msg}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  const content = lines.length > 0 ? lines.join("\n") : "LGTM";
  return { persona, content, hasBlocker };
}

export { PERSONA_LABELS };
