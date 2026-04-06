import { exec } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function tail(text: string, lines = 40): string {
  const parts = text.split("\n").filter(Boolean);
  return parts.slice(-lines).join("\n");
}

function formatVerifyError(step: string, cmd: string, err: unknown): string {
  const e = err as NodeJS.ErrnoException & {
    code?: number;
    stdout?: string;
    stderr?: string;
  };

  const stderrTail = tail(e.stderr ?? "");
  const stdoutTail = tail(e.stdout ?? "");
  const details = stderrTail || stdoutTail || e.message || String(err);
  const exit = typeof e.code === "number" ? `exit ${e.code}` : "exit unknown";

  return [
    `Verification failed (${step}) — ${exit}. MR creation blocked.`,
    `Command: ${cmd}`,
    details,
  ].join("\n");
}

async function runVerifyCommand(
  wtPath: string,
  cmd: string,
  timeout: number,
  step: "install" | "typecheck" | "test" | "build",
  sysLog: (content: string) => void
): Promise<void> {
  try {
    sysLog(`Running: ${cmd}...`);
    const { stdout, stderr } = await execAsync(cmd, { cwd: wtPath, timeout });
    const stderrTail = tail(stderr ?? "", 8);
    if (stderrTail) {
      sysLog(`[verify:${step}] stderr (tail):`);
      for (const line of stderrTail.split("\n")) {
        if (line.trim()) sysLog(`[verify:${step}] ${line}`);
      }
    }
    const stdoutTail = tail(stdout ?? "", 5);
    if (stdoutTail) {
      sysLog(`[verify:${step}] output (tail):`);
      for (const line of stdoutTail.split("\n")) {
        if (line.trim()) sysLog(`[verify:${step}] ${line}`);
      }
    }
  } catch (err: unknown) {
    throw new Error(formatVerifyError(step, cmd, err));
  }
}

async function detectPackageManager(wtPath: string): Promise<string> {
  const checks = [
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
  ] as const;
  for (const [file, pm] of checks) {
    try {
      await access(join(wtPath, file));
      return pm;
    } catch {}
  }
  return "npm";
}

async function readPackageScripts(wtPath: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(wtPath, "package.json"), "utf8");
    return JSON.parse(raw)?.scripts ?? {};
  } catch {
    return {};
  }
}

export async function verifyWorktree(
  wtPath: string,
  sysLog: (content: string) => void
): Promise<void> {
  try {
    await access(join(wtPath, "package.json"));
  } catch {
    sysLog("Skipping verification: no package.json found in worktree.");
    return;
  }

  sysLog("Starting verification step...");

  const pm = await detectPackageManager(wtPath);
  const scripts = await readPackageScripts(wtPath);

  await runVerifyCommand(wtPath, `${pm} install`, 120_000, "install", sysLog);

  // Only run typecheck if the script exists
  if (scripts.typecheck || scripts["type-check"] || scripts["tsc"]) {
    await runVerifyCommand(wtPath, `${pm} run typecheck`, 60_000, "typecheck", sysLog);
  }

  // Only run tests if there's a meaningful test script (not the "no test" placeholder)
  const testScript = scripts.test ?? "";
  const hasRealTests =
    testScript &&
    !testScript.includes("no test") &&
    !testScript.includes("No test") &&
    !testScript.includes("echo");

  if (hasRealTests) {
    await runVerifyCommand(wtPath, `${pm} test`, 120_000, "test", sysLog);
  } else {
    sysLog("Skipping tests: no test script found (or placeholder only).");
  }

  // Run build as final smoke test if script exists
  if (scripts.build) {
    await runVerifyCommand(wtPath, `${pm} run build`, 180_000, "build", sysLog);
  }

  sysLog("Verification passed successfully!");
}
