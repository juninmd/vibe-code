import { exec } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function verifyWorktree(
  wtPath: string,
  sysLog: (content: string) => void
): Promise<void> {
  const markers = ["package.json", "bunfig.toml", "tsconfig.json"];
  const hasProjectFiles = await Promise.all(
    markers.map(async (file) => {
      try {
        await access(join(wtPath, file));
        return true;
      } catch {
        return false;
      }
    })
  );

  if (!hasProjectFiles.some(Boolean)) {
    sysLog("Skipping verification: no package markers found in worktree.");
    return;
  }

  sysLog("Starting verification step (Jules mode)...");

  try {
    sysLog("Running: bun install...");
    await execAsync("bun install", { cwd: wtPath });

    sysLog("Running: bun test...");
    await execAsync("bun test", { cwd: wtPath });

    sysLog("Running: bun run typecheck...");
    await execAsync("bun run typecheck", { cwd: wtPath });

    sysLog("Verification passed successfully!");
  } catch (err: any) {
    const errorMsg = err.stdout || err.stderr || err.message;
    throw new Error(`Verification failed:\n${errorMsg}`);
  }
}
