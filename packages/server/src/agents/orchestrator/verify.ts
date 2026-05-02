import { readFile } from "node:fs/promises";
import { join } from "node:path";

type ValidationCommandSource = "workflow" | "package_json";

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
    source: "workflow",
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
    source: "package_json",
  }));
}

export async function discoverValidationCommands(wtPath: string): Promise<ValidationCommand[]> {
  try {
    const workflowText = await readFile(join(wtPath, WORKFLOW_FILE), "utf8");
    const workflowCommands = parseWorkflowCommands(workflowText);
    if (workflowCommands.length > 0) return workflowCommands;
  } catch {
    // Compatibility mode: fall through to package.json.
  }

  try {
    const packageJsonText = await readFile(join(wtPath, PACKAGE_JSON_FILE), "utf8");
    const packageJsonCommands = parsePackageJsonCommands(packageJsonText);
    if (packageJsonCommands.length > 0) return packageJsonCommands;
  } catch {
    // Unsupported repository shape.
  }

  throw new Error(
    "Verification failed: unable to discover validation commands from WORKFLOW.md or package.json"
  );
}

async function runValidationCommand(
  wtPath: string,
  validationCommand: ValidationCommand,
  sysLog: (content: string) => void
): Promise<ValidationCommandResult> {
  sysLog(`[verify] running ${validationCommand.command}`);
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

  return {
    ...validationCommand,
    exitCode,
    stdout,
    stderr,
    passed: exitCode === 0,
  };
}

function buildVerificationSummary(results: readonly ValidationCommandResult[]): string {
  return results
    .map((result) => `${result.name}=${result.passed ? "passed" : `failed(${result.exitCode})`}`)
    .join(", ");
}

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
