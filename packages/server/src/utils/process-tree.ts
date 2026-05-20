import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Recursively kills a process and all its child processes.
 * Works on Windows and Unix/Linux/macOS.
 */
export async function killProcessTree(pid: number): Promise<void> {
  const isWindows = process.platform === "win32";

  if (isWindows) {
    try {
      await execAsync(`taskkill /F /T /PID ${pid}`);
    } catch (err) {
      // taskkill exits with non-zero if process already died or wasn't found
      console.debug(`[process-tree] taskkill failed or process already dead for PID ${pid}:`, err);
    }
  } else {
    try {
      // Try killing the process group (negative PID) first
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        // Fallback: recursively query child pids and kill them
        const { stdout } = await execAsync(`pgrep -P ${pid}`);
        const pids = stdout
          .split("\n")
          .map((p) => Number.parseInt(p.trim(), 10))
          .filter(Number.isInteger);
        for (const childPid of pids) {
          await killProcessTree(childPid);
        }
        process.kill(pid, "SIGKILL");
      } catch (err) {
        console.debug(`[process-tree] unix kill fallback failed for PID ${pid}:`, err);
      }
    }
  }
}
