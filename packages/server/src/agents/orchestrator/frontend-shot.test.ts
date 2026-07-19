import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as playwright from "playwright";
import * as processTree from "../../utils/process-tree";

// Mock the dependencies
mock.module("node:fs", () => ({
  existsSync: mock(),
  readFileSync: mock(),
  promises: {
    mkdir: mock().mockResolvedValue(undefined),
  },
}));

mock.module("playwright", () => ({
  chromium: {
    launch: mock(),
  },
}));

mock.module("../../utils/process-tree", () => ({
  killProcessTree: mock().mockResolvedValue(undefined),
}));

// Import after mocking
import { captureFrontendScreenshotIfNeeded } from "./frontend-shot";

describe("captureFrontendScreenshotIfNeeded", () => {
  let mockDb: any;
  let mockSysLog: any;
  let mockTask: any;
  let mockRun: any;
  const wtPath = "/mock/wt/path";

  beforeEach(() => {
    mockDb = {
      artifacts: {
        upsert: mock(),
      },
    };
    mockSysLog = mock();
    mockTask = { id: "test-task" };
    mockRun = { id: "test-run" };

    // Reset mocks
    (fs.existsSync as any).mockReset();
    (fs.readFileSync as any).mockReset();
    (playwright.chromium.launch as any).mockReset();
    (processTree.killProcessTree as any).mockReset();
  });

  test("does nothing if package.json does not exist", async () => {
    (fs.existsSync as any).mockReturnValue(false);
    await captureFrontendScreenshotIfNeeded(wtPath, mockTask, mockRun, mockDb, mockSysLog);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  test("does nothing if package.json is invalid JSON", async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue("invalid json");
    await captureFrontendScreenshotIfNeeded(wtPath, mockTask, mockRun, mockDb, mockSysLog);
    expect(mockSysLog).not.toHaveBeenCalled();
  });

  test("skips screenshot if Electron app is detected", async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(
      JSON.stringify({
        dependencies: { electron: "^1.0.0" },
      })
    );
    await captureFrontendScreenshotIfNeeded(wtPath, mockTask, mockRun, mockDb, mockSysLog);
    expect(mockSysLog).toHaveBeenCalledWith(
      expect.stringContaining("Electron desktop application detected")
    );
  });

  test("skips screenshot if no frontend dependency is detected", async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(
      JSON.stringify({
        dependencies: { lodash: "^4.17.21" },
        scripts: { dev: "node server.js" },
      })
    );
    await captureFrontendScreenshotIfNeeded(wtPath, mockTask, mockRun, mockDb, mockSysLog);
    expect(mockSysLog).not.toHaveBeenCalled();
  });

  test("skips screenshot if no dev/start script is detected", async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(
      JSON.stringify({
        dependencies: { react: "^18.0.0" },
        scripts: { build: "react-scripts build" },
      })
    );
    await captureFrontendScreenshotIfNeeded(wtPath, mockTask, mockRun, mockDb, mockSysLog);
    expect(mockSysLog).not.toHaveBeenCalled();
  });

  test("fails gracefully when dev server process cannot be spawned", async () => {
    (fs.existsSync as any).mockImplementation(
      (path: string) => path.endsWith("package.json") || path.endsWith("pnpm-lock.yaml")
    );
    (fs.readFileSync as any).mockReturnValue(
      JSON.stringify({
        dependencies: { react: "^18.0.0" },
        scripts: { dev: "vite" },
      })
    );

    const mockSpawn = mock().mockReturnValue({ pid: undefined });
    const originalSpawn = Bun.spawn;
    Bun.spawn = mockSpawn as any;

    await captureFrontendScreenshotIfNeeded(wtPath, mockTask, mockRun, mockDb, mockSysLog);

    expect(mockSysLog).toHaveBeenCalledWith(
      expect.stringContaining("Failed to spawn dev server process")
    );
    Bun.spawn = originalSpawn;
  });

  test("fails gracefully when no listening port is detected (timeout)", async () => {
    (fs.existsSync as any).mockImplementation((path: string) => path.endsWith("package.json"));
    (fs.readFileSync as any).mockReturnValue(
      JSON.stringify({
        dependencies: { react: "^18.0.0" },
        scripts: { dev: "vite" },
      })
    );

    const mockSpawn = mock().mockReturnValue({ pid: 12345 });
    const originalSpawn = Bun.spawn;
    Bun.spawn = mockSpawn as any;

    const originalSleep = Bun.sleep;
    Bun.sleep = mock().mockResolvedValue(undefined) as any;

    const originalConnect = Bun.connect;
    Bun.connect = mock().mockImplementation(() => {
      return new Promise((resolve, reject) => {
        reject(new Error("Connection refused"));
      });
    }) as any;

    await captureFrontendScreenshotIfNeeded(wtPath, mockTask, mockRun, mockDb, mockSysLog);

    expect(mockSysLog).toHaveBeenCalledWith(
      expect.stringContaining("no listening port was detected on localhost after 15s")
    );
    expect(processTree.killProcessTree).toHaveBeenCalledWith(12345);

    Bun.spawn = originalSpawn;
    Bun.sleep = originalSleep;
    Bun.connect = originalConnect;
  });

  test("captures screenshot when frontend is detected and dev server starts", async () => {
    (fs.existsSync as any).mockImplementation(
      (path: string) => path.endsWith("package.json") || path.endsWith("bun.lockb")
    );
    (fs.readFileSync as any).mockReturnValue(
      JSON.stringify({
        dependencies: { react: "^18.0.0" },
        scripts: { dev: "vite" },
      })
    );

    const mockSpawn = mock().mockReturnValue({ pid: 12345 });
    const originalSpawn = Bun.spawn;
    Bun.spawn = mockSpawn as any;

    const originalSleep = Bun.sleep;
    Bun.sleep = mock().mockResolvedValue(undefined) as any;

    const originalConnect = Bun.connect;
    const mockConn = { close: mock() };
    let connectCalls = 0;
    Bun.connect = mock().mockImplementation(() => {
      connectCalls++;
      if (connectCalls > 2) return Promise.resolve(mockConn);
      return new Promise((resolve, reject) => {
        reject(new Error("Connection refused"));
      });
    }) as any;

    const mockPage = {
      goto: mock().mockResolvedValue(undefined),
      waitForTimeout: mock().mockResolvedValue(undefined),
      screenshot: mock().mockResolvedValue(undefined),
    };
    const mockBrowser = {
      newPage: mock().mockResolvedValue(mockPage),
      close: mock().mockResolvedValue(undefined),
    };
    (playwright.chromium.launch as any).mockResolvedValue(mockBrowser);

    const originalMkdir = fs.promises.mkdir;
    fs.promises.mkdir = mock().mockResolvedValue(undefined) as any;

    await captureFrontendScreenshotIfNeeded(wtPath, mockTask, mockRun, mockDb, mockSysLog);

    expect(mockSysLog).toHaveBeenCalledWith(
      expect.stringContaining("Starting dev server using bun run dev")
    );
    expect(mockSysLog).toHaveBeenCalledWith(expect.stringContaining("Live frontend detected"));
    expect(playwright.chromium.launch).toHaveBeenCalled();
    expect(mockPage.goto).toHaveBeenCalled();
    expect(mockPage.screenshot).toHaveBeenCalled();
    expect(mockDb.artifacts.upsert).toHaveBeenCalled();
    expect(processTree.killProcessTree).toHaveBeenCalledWith(12345);

    Bun.spawn = originalSpawn;
    Bun.sleep = originalSleep;
    Bun.connect = originalConnect;
    fs.promises.mkdir = originalMkdir;
  });
});
