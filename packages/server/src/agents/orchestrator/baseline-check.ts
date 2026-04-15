import { access } from "node:fs/promises";
import { join } from "node:path";

export interface BaselineCheckResult {
  passed: boolean;
  skipped: boolean;
  details: string;
}

/**
 * Run a lightweight baseline verification in `wtPath` BEFORE the agent starts.
 *
 * Purpose: detect pre-existing broken states so the agent knows upfront what's
 * already broken (and doesn't waste loops trying to fix something it didn't cause).
 *
 * The check is intentionally fast — it only runs commands that are already present
 * in the worktree. If neither `package.json` nor a `Makefile` is found, the check
 * is skipped rather than blocking execution.
 *
 * Controlled by env var `VIBE_CODE_SKIP_BASELINE_CHECK=true`.
 */
export async function runBaselineCheck(wtPath: string): Promise<BaselineCheckResult> {
  if (process.env.VIBE_CODE_SKIP_BASELINE_CHECK === "true") {
    return { passed: true, skipped: true, details: "Skipped via VIBE_CODE_SKIP_BASELINE_CHECK" };
  }

  // Discover which runner is available in this worktree
  const runner = await detectRunner(wtPath);
  if (!runner) {
    return {
      passed: true,
      skipped: true,
      details: "No package.json / Makefile found — baseline check skipped",
    };
  }

  const results: string[] = [];
  let anyFailed = false;

  for (const cmd of runner.commands) {
    const outcome = await runCmd(cmd, wtPath);
    if (!outcome.ok) anyFailed = true;
    results.push(`[${outcome.ok ? "✓" : "✗"}] ${cmd.join(" ")}`);
    if (outcome.output.trim()) {
      // Include only the last 10 lines to avoid bloating the context
      const lines = outcome.output.trim().split("\n");
      const tail = lines.slice(-10).join("\n");
      results.push(tail);
    }
  }

  return {
    passed: !anyFailed,
    skipped: false,
    details: results.join("\n"),
  };
}

interface Runner {
  name: string;
  commands: string[][];
}

async function detectRunner(wtPath: string): Promise<Runner | null> {
  // Try bun first, then npm, then make
  const pkgPath = join(wtPath, "package.json");
  const makePath = join(wtPath, "Makefile");

  const hasPkg = await fileExists(pkgPath);
  const hasMake = await fileExists(makePath);

  if (hasPkg) {
    // Only run typecheck — tests may be slow and we want fast feedback
    // Use --bail so typecheck fails fast on first error
    const pkgJson = await readJsonSafe(pkgPath);
    const scripts: Record<string, string> = pkgJson?.scripts ?? {};

    const commands: string[][] = [];

    if (scripts.typecheck) {
      commands.push(["bun", "run", "typecheck"]);
    } else if (scripts["type-check"]) {
      commands.push(["bun", "run", "type-check"]);
    }

    if (commands.length === 0) return null;
    return { name: "bun", commands };
  }

  if (hasMake) {
    return { name: "make", commands: [["make", "typecheck"]] };
  }

  return null;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(path: string): Promise<Record<string, any> | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function runCmd(args: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
  try {
    const proc = Bun.spawn(args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      // 60 s timeout — fast commands only
    });

    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 60_000));
    await Promise.race([proc.exited, timeout]);

    const stdout = await new Response(proc.stdout).text().catch(() => "");
    const stderr = await new Response(proc.stderr).text().catch(() => "");
    const output = [stdout, stderr].filter(Boolean).join("\n");
    const ok = (proc.exitCode ?? 1) === 0;
    return { ok, output };
  } catch (err: any) {
    return { ok: false, output: err.message ?? String(err) };
  }
}
