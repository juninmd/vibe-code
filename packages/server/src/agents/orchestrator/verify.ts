import { exec } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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

  try {
    sysLog(`Running: ${pm} install...`);
    await execAsync(`${pm} install`, { cwd: wtPath, timeout: 120_000 });
  } catch (err: unknown) {
    const errorMsg = (err as NodeJS.ErrnoException).message ?? String(err);
    throw new Error(`Verification failed (install):\n${errorMsg}`);
  }

  // Only run typecheck if the script exists
  if (scripts.typecheck || scripts["type-check"] || scripts["tsc"]) {
    try {
      sysLog(`Running: ${pm} run typecheck...`);
      await execAsync(`${pm} run typecheck`, { cwd: wtPath, timeout: 60_000 });
    } catch (err: unknown) {
      const errorMsg = (err as NodeJS.ErrnoException).message ?? String(err);
      throw new Error(`Verification failed (typecheck):\n${errorMsg}`);
    }
  }

  // Only run tests if there's a meaningful test script (not the "no test" placeholder)
  const testScript = scripts.test ?? "";
  const hasRealTests =
    testScript &&
    !testScript.includes("no test") &&
    !testScript.includes("No test") &&
    !testScript.includes("echo");

  if (hasRealTests) {
    try {
      sysLog(`Running: ${pm} test...`);
      await execAsync(`${pm} test`, { cwd: wtPath, timeout: 120_000 });
    } catch (err: unknown) {
      const errorMsg = (err as NodeJS.ErrnoException).message ?? String(err);
      throw new Error(`Verification failed (test):\n${errorMsg}`);
    }
  } else {
    sysLog("Skipping tests: no test script found (or placeholder only).");
  }

  // Run build as final smoke test if script exists
  if (scripts.build) {
    try {
      sysLog(`Running: ${pm} run build...`);
      await execAsync(`${pm} run build`, { cwd: wtPath, timeout: 180_000 });
    } catch (err: unknown) {
      const errorMsg = (err as NodeJS.ErrnoException).message ?? String(err);
      throw new Error(`Verification failed (build):\n${errorMsg}`);
    }
  }

  sysLog("Verification passed successfully!");
}
