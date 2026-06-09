import { existsSync, promises as fs, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRun, Task } from "@vibe-code/shared";
import { chromium } from "playwright";
import type { Db } from "../../db";
import { killProcessTree } from "../../utils/process-tree";

export async function captureFrontendScreenshotIfNeeded(
  wtPath: string,
  task: Task,
  run: AgentRun,
  db: Db,
  sysLog: (content: string) => void
): Promise<void> {
  const pkgPath = join(wtPath, "package.json");
  if (!existsSync(pkgPath)) return;

  let pkg: any;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return;
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (
    deps.electron ||
    deps["electron-builder"] ||
    deps["electron-packager"] ||
    deps["electron-rebuild"]
  ) {
    sysLog(
      "[verify] Electron desktop application detected. Skipping Playwright browser screenshot capture."
    );
    return;
  }

  const frontendKeywords = [
    "react",
    "vue",
    "svelte",
    "vite",
    "next",
    "astro",
    "nuxt",
    "solid-js",
    "tailwindcss",
    "@tailwindcss/vite",
    "react-dom",
    "angular",
  ];
  const hasFrontendDep = Object.keys(deps).some((dep) => frontendKeywords.includes(dep));
  const scripts = Object.keys(pkg.scripts || {});
  const devScript = scripts.includes("dev") ? "dev" : scripts.includes("start") ? "start" : null;

  if (!hasFrontendDep || !devScript) {
    return;
  }

  sysLog(
    `[verify] Frontend detected in worktree (script: ${devScript}). Preparing Playwright screenshot capture...`
  );

  // Detect package manager
  let pm = "npm";
  if (existsSync(join(wtPath, "bun.lockb")) || existsSync(join(wtPath, "bun.lock"))) {
    pm = "bun";
  } else if (existsSync(join(wtPath, "pnpm-lock.yaml"))) {
    pm = "pnpm";
  } else if (existsSync(join(wtPath, "yarn.lock"))) {
    pm = "yarn";
  }

  // Start dev server in the background
  sysLog(`[verify] Starting dev server using ${pm} run ${devScript}...`);
  const devProc = Bun.spawn([pm, "run", devScript], {
    cwd: wtPath,
    env: { ...process.env, PORT: "5174" }, // suggest 5174 to avoid conflict
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!devProc.pid) {
    sysLog(`[verify] Failed to spawn dev server process.`);
    return;
  }

  let matchedPort: number | null = null;
  const commonPorts = [5173, 5174, 3000, 3001, 8080, 8081, 4173];

  // Poll ports to check when it starts listening (try for 15 seconds)
  sysLog(`[verify] Polling ports ${commonPorts.join(", ")} to detect live frontend...`);
  for (let i = 0; i < 30; i++) {
    await Bun.sleep(500);
    for (const port of commonPorts) {
      try {
        const conn = await Bun.connect({
          hostname: "127.0.0.1",
          port,
          socket: {
            data() {},
            open() {},
            close() {},
            error() {},
          },
        });
        conn.close();
        matchedPort = port;
        break;
      } catch {
        // port not listening yet
      }
    }
    if (matchedPort) break;
  }

  if (!matchedPort) {
    sysLog(
      `[verify] Dev server started (PID: ${devProc.pid}) but no listening port was detected on localhost after 15s. Skipping screenshot.`
    );
    try {
      await killProcessTree(devProc.pid);
    } catch {}
    return;
  }

  sysLog(`[verify] Live frontend detected on port ${matchedPort}! Launching Playwright...`);

  let browser: any = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // Navigate to local app
    sysLog(`[verify] Navigating to http://127.0.0.1:${matchedPort}...`);
    await page.goto(`http://127.0.0.1:${matchedPort}`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
    await page.waitForTimeout(2500); // let UI animations/renders settle

    const screenshotDir = join(wtPath, "docs/assets");
    await fs.mkdir(screenshotDir, { recursive: true });
    const relativeFilename = `docs/assets/task-${task.id}-ui.png`;
    const screenshotPath = join(wtPath, relativeFilename);

    await page.screenshot({ path: screenshotPath });
    sysLog(`[verify] Screenshot successfully captured and saved to ${relativeFilename} 📸`);

    // Record as task artifact
    db.artifacts.upsert({
      taskId: task.id,
      runId: run.id,
      kind: "other",
      title: "Visual Evidence (E2E Screenshot)",
      uri: `file:///${screenshotPath.replace(/\\/g, "/")}`,
      metadata: { path: relativeFilename, port: matchedPort },
    });
  } catch (err: any) {
    sysLog(`[verify] Playwright screenshot capture failed: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    sysLog(`[verify] Stopping dev server (killing PID tree ${devProc.pid})...`);
    try {
      await killProcessTree(devProc.pid);
    } catch {}
  }
}
