/**
 * Reviewer engine — runs a specialized persona prompt (Claude/Gemini)
 * against the current git diff before PR creation.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ReviewPersona = "frontend" | "backend" | "security" | "quality";

interface ReviewEvent {
  persona: ReviewPersona;
  content: string;
  hasBlocker: boolean;
}

type ReviewRuntime = "claude" | "gemini";

function pickReviewRuntime(engineName?: string): ReviewRuntime {
  if (!engineName) return "claude";
  if (engineName.toLowerCase().includes("gemini")) return "gemini";
  return "claude";
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
 * Run a single persona review using the selected review runtime.
 * Returns a stream of text lines and whether any BLOCKER was found.
 */
export async function runPersonaReview(opts: {
  persona: ReviewPersona;
  worktreePath: string;
  taskTitle: string;
  taskDescription: string;
  defaultBranch: string;
  reviewEngine?: string;
  reviewModel?: string;
}): Promise<ReviewEvent> {
  const {
    persona,
    worktreePath,
    taskTitle,
    taskDescription,
    defaultBranch,
    reviewEngine,
    reviewModel,
  } = opts;

  const diff = await getWorktreeDiff(worktreePath, defaultBranch);
  const label = PERSONA_LABELS[persona];
  const runtime = pickReviewRuntime(reviewEngine);

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

    if (runtime === "gemini") {
      lines.push(
        "INFO: [reviewer:gemini] Running with IDE-related env removed from child process (prevents workspace mismatch and IDE companion warnings in detached worktrees)"
      );
    }

    const args =
      runtime === "gemini"
        ? ["gemini", "--yolo", ...(reviewModel ? ["-m", reviewModel] : []), "-p", prompt]
        : ["claude", "--print", "-p", `@${promptFile}`];

    const childEnv =
      runtime === "gemini"
        ? (() => {
            const env = { ...process.env };
            // Detached review worktrees should not attach to VS Code Gemini IDE client.
            delete env.GEMINI_CLI_IDE_SERVER_PORT;
            delete env.GEMINI_CLI_IDE_WORKSPACE_PATH;
            delete env.GEMINI_CLI_IDE_AUTH_TOKEN;
            delete env.TERM_PROGRAM;
            delete env.VSCODE_INJECTION;
            delete env.VSCODE_GIT_ASKPASS_NODE;
            delete env.VSCODE_GIT_ASKPASS_EXTRA_ARGS;
            delete env.VSCODE_GIT_ASKPASS_MAIN;
            delete env.VSCODE_GIT_IPC_HANDLE;
            return env;
          })()
        : process.env;

    const proc = Bun.spawn(args, {
      cwd: worktreePath,
      stdout: "pipe",
      stderr: "pipe",
      env: childEnv,
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

    const [exitCode, stderrText] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text().catch(() => ""),
    ]);

    if (stderrText.trim()) {
      for (const line of stderrText.split("\n")) {
        if (!line.trim()) continue;
        lines.push(`INFO: [reviewer:${runtime}:stderr] ${line}`);
      }
    }

    if ((exitCode ?? 0) !== 0) {
      const stderrSummary = stderrText.trim().split("\n").slice(-2).join(" | ");
      lines.push(
        `BLOCKER: [reviewer] ${label} review failed (${runtime}) with exit code ${exitCode}${stderrSummary ? `: ${stderrSummary}` : ""}`
      );
      hasBlocker = true;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`BLOCKER: [reviewer] ${label} review failed (${runtime}): ${msg}`);
    hasBlocker = true;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  const content = lines.length > 0 ? lines.join("\n") : "LGTM";
  return { persona, content, hasBlocker };
}

export { PERSONA_LABELS };
