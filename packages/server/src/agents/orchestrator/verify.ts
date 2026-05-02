import { readFile } from "node:fs/promises";
import { join } from "node:path";

type ValidationCommandSource = "workflow" | "package_json" | "detected";

export interface ValidationCommand {
  readonly name: string;
  readonly command: string;
  readonly source: ValidationCommandSource;
}

export interface ValidationCommandResult {
  readonly name: string;
  readonly command: string;
  readonly source: ValidationCommandSource;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly passed: boolean;
  readonly reason: string;
}

export interface WorktreeVerificationResult {
  readonly passed: boolean;
  readonly commands: readonly string[];
  readonly results: readonly ValidationCommandResult[];
  readonly summary: string;
}

export interface RunQualityScoreInput {
  readonly validatorAttempts: number;
  readonly reviewBlockers: number;
  readonly reviewWarnings: number;
  readonly finalStatus: string;
  readonly prCreated: boolean;
}

const WORKFLOW_FILE = "WORKFLOW.md";
const PACKAGE_JSON_FILE = "package.json";
const WORKFLOW_QUALITY_GATE_HEADING = "## Current Quality Gate";
const README_FILE = "README.md";

function getShellCommand(command: string): string[] {
  if (process.platform === "win32") {
    return ["powershell.exe", "-NoProfile", "-Command", command];
  }
  return ["sh", "-lc", command];
}

function normalizeCommandLines(block: string): string[] {
  return block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function parseWorkflowCommands(workflowText: string): ValidationCommand[] {
  const headingIndex = workflowText.indexOf(WORKFLOW_QUALITY_GATE_HEADING);
  if (headingIndex < 0) return [];

  const afterHeading = workflowText.slice(headingIndex + WORKFLOW_QUALITY_GATE_HEADING.length);
  const codeFenceMatch = afterHeading.match(/```(?:bash|sh|shell)?\s*([\s\S]*?)```/i);
  if (!codeFenceMatch?.[1]) return [];

  return normalizeCommandLines(codeFenceMatch[1]).map((command, index) => ({
    name: `workflow_${index + 1}`,
    command,
    source: "workflow" as const,
  }));
}

function detectPackageManagerScriptCommand(scriptName: string, packageManager?: string): string {
  if (packageManager?.startsWith("pnpm")) return `pnpm ${scriptName}`;
  if (packageManager?.startsWith("yarn")) return `yarn ${scriptName}`;
  if (packageManager?.startsWith("npm")) return `npm run ${scriptName}`;
  return `bun run ${scriptName}`;
}

function parsePackageJsonCommands(packageJsonText: string): ValidationCommand[] {
  const parsed = JSON.parse(packageJsonText) as {
    packageManager?: string;
    scripts?: Record<string, string>;
  };
  const scripts = parsed.scripts ?? {};
  const orderedNames = ["lint", "typecheck", "test", "build"].filter((name) => scripts[name]);

  return orderedNames.map((name) => ({
    name,
    command: detectPackageManagerScriptCommand(name, parsed.packageManager),
    source: "package_json" as const,
  }));
}

/** Detect additional validation commands from common project files */
async function detectAdditionalCommands(wtPath: string): Promise<ValidationCommand[]> {
  const commands: ValidationCommand[] = [];

  // Check for Makefile
  try {
    const makefile = await readFile(join(wtPath, "Makefile"), "utf8");
    const lines = makefile.split("\n");
    const targets = new Set<string>();
    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+):/);
      if (match && !match[1].startsWith(".")) {
        targets.add(match[1]);
      }
    }
    // Add common targets if present
    for (const target of ["test", "lint", "check", "validate"]) {
      if (targets.has(target)) {
        commands.push({
          name: `make:${target}`,
          command: `make ${target}`,
          source: "detected",
        });
      }
    }
  } catch {
    /* no Makefile */
  }

  // Check README for build/run instructions
  try {
    const readme = await readFile(join(wtPath, README_FILE), "utf8");
    // Look for "```bash" blocks with common commands
    const bashBlocks = readme.match(/```bash\n([\s\S]*?)```/gi) || [];
    for (const block of bashBlocks) {
      const cmds = block
        .replace(/```bash\n?/gi, "")
        .trim()
        .split("\n");
      for (const cmd of cmds) {
        const trimmed = cmd.trim();
        if (
          trimmed.startsWith("npm run ") ||
          trimmed.startsWith("pnpm ") ||
          trimmed.startsWith("bun ") ||
          trimmed.startsWith("yarn ")
        ) {
          const name = `${trimmed.split(" ")[0]} ${trimmed.split(" ")[1]}`;
          if (!commands.some((c) => c.command === trimmed)) {
            commands.push({ name, command: trimmed, source: "detected" });
          }
        }
      }
    }
  } catch {
    /* no README */
  }

  return commands;
}

export async function discoverValidationCommands(wtPath: string): Promise<ValidationCommand[]> {
  // Try WORKFLOW.md first
  try {
    const workflowText = await readFile(join(wtPath, WORKFLOW_FILE), "utf8");
    const workflowCommands = parseWorkflowCommands(workflowText);
    if (workflowCommands.length > 0) return workflowCommands;
  } catch {
    // Compatibility mode: fall through to package.json.
  }

  // Try package.json
  try {
    const packageJsonText = await readFile(join(wtPath, PACKAGE_JSON_FILE), "utf8");
    const packageJsonCommands = parsePackageJsonCommands(packageJsonText);
    if (packageJsonCommands.length > 0) return packageJsonCommands;
  } catch {
    // Unsupported repository shape.
  }

  // Try to detect additional commands
  const additional = await detectAdditionalCommands(wtPath);
  if (additional.length > 0) return additional;

  throw new Error(
    "Verification failed: unable to discover validation commands from WORKFLOW.md or package.json"
  );
}

async function runValidationCommand(
  wtPath: string,
  validationCommand: ValidationCommand,
  sysLog: (content: string) => void
): Promise<ValidationCommandResult> {
  sysLog(`[verify] running: ${validationCommand.command}`);
  const proc = Bun.spawn(getShellCommand(validationCommand.command), {
    cwd: wtPath,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: process.env,
  });

  const stdout = (await new Response(proc.stdout).text()).trim();
  const stderr = (await new Response(proc.stderr).text()).trim();
  const exitCode = await proc.exited;

  if (stdout) {
    for (const line of stdout.split(/\r?\n/)) {
      if (line.trim()) sysLog(`[verify:${validationCommand.name}] ${line}`);
    }
  }

  if (stderr) {
    for (const line of stderr.split(/\r?\n/)) {
      if (line.trim()) sysLog(`[verify:${validationCommand.name}] ${line}`);
    }
  }

  const passed = exitCode === 0;
  const reason = passed
    ? "passed"
    : extractFailureReasonRaw(
        validationCommand.name,
        validationCommand.command,
        exitCode,
        stdout,
        stderr
      );

  return {
    ...validationCommand,
    exitCode,
    stdout,
    stderr,
    passed,
    reason,
  };
}

function buildVerificationSummary(results: readonly ValidationCommandResult[]): string {
  return results
    .map((result) => `${result.name}=${result.passed ? "passed" : `failed(${result.exitCode})`}`)
    .join(", ");
}

/** Extract a human-readable failure reason from validation command raw output (before building full result) */
function extractFailureReasonRaw(
  _name: string,
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string
): string {
  const combined = [stdout, stderr].filter(Boolean).join("\n");

  if (exitCode === 0) return "passed";

  const testMatch = combined.match(
    /((FAIL|FAILURE|ERROR|✕|×|FAILED)[\s\S]*?(?=\d+\s+(pass|fail|pending)|$))/i
  );
  if (testMatch) {
    const snippet = testMatch[0].slice(0, 500);
    return `exit ${exitCode} — ${snippet.replace(/\n/g, " ").trim()}`;
  }

  const buildMatch = combined.match(/(error[^:]+:[^\n]+)/i) || combined.match(/(Error:[^\n]+)/i);
  if (buildMatch) {
    return `exit ${exitCode} — ${buildMatch[0].slice(0, 200)}`;
  }

  const lintMatch = combined.match(/(warning|error)[\s\S]*?at line \d+/i);
  if (lintMatch) {
    return `exit ${exitCode} — ${lintMatch[0].slice(0, 200)}`;
  }

  const lines = combined.split("\n").filter(Boolean);
  const lastUseful = lines.filter((l) => !l.match(/^\s*(✓|✔|passed|done|building|compiling)/i));
  if (lastUseful.length > 0) {
    return `exit ${exitCode} — ${lastUseful[lastUseful.length - 1].slice(0, 200)}`;
  }

  return `exit ${exitCode} (command: ${command})`;
}

/** Extract a human-readable failure reason from a ValidationCommandResult */
function extractFailureReason(result: ValidationCommandResult): string {
  const { command, exitCode, stdout, stderr } = result;

  if (exitCode === 0) return "passed";

  const testMatch =
    stderr.match(/((FAIL|FAILURE|ERROR|✕|×|FAILED)[\s\S]*?(?=\d+\s+(pass|fail|pending)|$))/i) ||
    stdout.match(/((FAIL|FAILURE|ERROR|✕|×|FAILED)[\s\S]*?(?=\d+\s+(pass|fail|pending)|$))/i);
  if (testMatch) {
    const snippet = testMatch[0].slice(0, 500);
    return `exit ${exitCode} — ${snippet.replace(/\n/g, " ").trim()}`;
  }

  const buildMatch =
    stderr.match(/(error[^:]+:[^\n]+)/i) ||
    stdout.match(/(error[^:]+:[^\n]+)/i) ||
    stderr.match(/(Error:[^\n]+)/i) ||
    stdout.match(/(Error:[^\n]+)/i);
  if (buildMatch) {
    return `exit ${exitCode} — ${buildMatch[0].slice(0, 200)}`;
  }

  const lintMatch =
    stderr.match(/(warning|error)[\s\S]*?at line \d+/i) ||
    stdout.match(/(warning|error)[\s\S]*?at line \d+/i);
  if (lintMatch) {
    return `exit ${exitCode} — ${lintMatch[0].slice(0, 200)}`;
  }

  const lines = [stdout, stderr].filter(Boolean).join("\n").split("\n").filter(Boolean);
  const lastUseful = lines.filter((l) => !l.match(/^\s*(✓|✔|passed|done|building|compiling)/i));
  if (lastUseful.length > 0) {
    return `exit ${exitCode} — ${lastUseful[lastUseful.length - 1].slice(0, 200)}`;
  }

  return `exit ${exitCode} (command: ${command})`;
}

function _formatVerificationResult(result: ValidationCommandResult, verbose: boolean): string {
  if (result.passed) {
    return `  ✓ ${result.name}`;
  }
  const reason = extractFailureReason(result);
  if (verbose) {
    const lines = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(-800);
    return `  ✗ ${result.name}: ${reason}\n    output: ${lines}`;
  }
  return `  ✗ ${result.name}: ${reason}`;
}

/**
 * Verify the worktree by running all discovered validation commands.
 * Runs commands sequentially (one at a time) so output is easier to debug.
 * Fails fast on first failure for efficiency.
 */
export async function verifyWorktree(
  wtPath: string,
  sysLog: (content: string) => void
): Promise<WorktreeVerificationResult> {
  const commands = await discoverValidationCommands(wtPath);
  const results: ValidationCommandResult[] = [];

  for (const validationCommand of commands) {
    const result = await runValidationCommand(wtPath, validationCommand, sysLog);
    results.push(result);
    if (!result.passed) {
      return {
        passed: false,
        commands: commands.map((item) => item.command),
        results,
        summary: buildVerificationSummary(results),
      };
    }
  }

  return {
    passed: true,
    commands: commands.map((item) => item.command),
    results,
    summary: buildVerificationSummary(results),
  };
}

export function computeRunQualityScore(input: RunQualityScoreInput): number {
  let score = 100;
  score -= Math.max(input.validatorAttempts - 1, 0) * 8;
  score -= input.reviewBlockers * 20;
  score -= input.reviewWarnings * 4;
  if (input.finalStatus !== "completed") score -= 25;
  if (input.prCreated) score += 5;
  return Math.max(0, Math.min(100, score));
}

/**
 * Run verification commands in parallel for faster validation.
 * Returns results as they complete, including failures.
 */
export async function verifyWorktreeParallel(
  wtPath: string,
  sysLog: (content: string) => void,
  maxConcurrency = 3
): Promise<WorktreeVerificationResult> {
  const commands = await discoverValidationCommands(wtPath);
  const results: ValidationCommandResult[] = [];
  let passed = true;

  // Process in batches to avoid overwhelming the system
  for (let i = 0; i < commands.length; i += maxConcurrency) {
    const batch = commands.slice(i, i + maxConcurrency);
    const batchResults = await Promise.all(
      batch.map((cmd) => runValidationCommand(wtPath, cmd, sysLog))
    );

    for (const result of batchResults) {
      results.push(result);
      if (!result.passed) {
        passed = false;
      }
    }

    // Fail fast on first failure
    if (!passed) {
      return {
        passed: false,
        commands: commands.map((item) => item.command),
        results,
        summary: buildVerificationSummary(results),
      };
    }
  }

  return {
    passed: true,
    commands: commands.map((item) => item.command),
    results,
    summary: buildVerificationSummary(results),
  };
}
