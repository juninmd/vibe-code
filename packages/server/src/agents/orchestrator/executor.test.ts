import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoInstallDependencies, runWorkspaceScripts } from "./executor";

describe("autoInstallDependencies", () => {
  let spawnSpy: any;

  afterEach(() => {
    if (spawnSpy) {
      spawnSpy.mockRestore();
    }
  });

  const mockSpawn = () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      return {
        exited: Promise.resolve(0),
        stdout: (async function* () {
          yield new TextEncoder().encode("mocked stdout");
        })(),
        stderr: (async function* () {
          yield new TextEncoder().encode("mocked stderr");
        })(),
        kill: () => {},
      } as any;
    });
  };

  it("does nothing if there is no package.json", async () => {
    mockSpawn();
    const dir = await mkdtemp(join(tmpdir(), "vibe-deps-"));
    const logs: string[] = [];
    try {
      await autoInstallDependencies(dir, (msg) => logs.push(msg));
      expect(logs.length).toBe(0);
      expect(spawnSpy).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects bun.lock and runs bun install", async () => {
    mockSpawn();
    const dir = await mkdtemp(join(tmpdir(), "vibe-deps-"));
    const logs: string[] = [];
    try {
      await writeFile(join(dir, "package.json"), "{}");
      await writeFile(join(dir, "bun.lock"), "");
      await autoInstallDependencies(dir, (msg) => logs.push(msg));
      expect(logs).toContain("Detecting package manager for dependency installation...");
      expect(
        logs.some((l) => l.includes("Running automatic dependency installation: bun install..."))
      ).toBe(true);
      expect(spawnSpy).toHaveBeenCalled();
      const cmd = spawnSpy.mock.calls[0][0];
      expect(cmd).toEqual(["bun", "install"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects pnpm-lock.yaml and runs pnpm install", async () => {
    mockSpawn();
    const dir = await mkdtemp(join(tmpdir(), "vibe-deps-"));
    const logs: string[] = [];
    try {
      await writeFile(join(dir, "package.json"), "{}");
      await writeFile(join(dir, "pnpm-lock.yaml"), "");
      await autoInstallDependencies(dir, (msg) => logs.push(msg));
      expect(
        logs.some((l) => l.includes("Running automatic dependency installation: pnpm install..."))
      ).toBe(true);
      expect(spawnSpy).toHaveBeenCalled();
      const cmd = spawnSpy.mock.calls[0][0];
      expect(cmd).toEqual(["pnpm", "install"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects package-lock.json and runs npm install", async () => {
    mockSpawn();
    const dir = await mkdtemp(join(tmpdir(), "vibe-deps-"));
    const logs: string[] = [];
    try {
      await writeFile(join(dir, "package.json"), "{}");
      await writeFile(join(dir, "package-lock.json"), "");
      await autoInstallDependencies(dir, (msg) => logs.push(msg));
      expect(
        logs.some((l) => l.includes("Running automatic dependency installation: npm install..."))
      ).toBe(true);
      expect(spawnSpy).toHaveBeenCalled();
      const cmd = spawnSpy.mock.calls[0][0];
      expect(cmd).toEqual(["npm", "install"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("defaults to bun install", async () => {
    mockSpawn();
    const dir = await mkdtemp(join(tmpdir(), "vibe-deps-"));
    const logs: string[] = [];
    try {
      await writeFile(join(dir, "package.json"), "{}");
      await autoInstallDependencies(dir, (msg) => logs.push(msg));
      expect(
        logs.some((l) => l.includes("Running automatic dependency installation: bun install..."))
      ).toBe(true);
      expect(spawnSpy).toHaveBeenCalled();
      const cmd = spawnSpy.mock.calls[0][0];
      expect(cmd).toEqual(["bun", "install"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("runWorkspaceScripts", () => {
  let spawnSpy: any;

  afterEach(() => {
    if (spawnSpy) {
      spawnSpy.mockRestore();
    }
  });

  const mockSpawn = () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      return {
        exited: Promise.resolve(0),
        stdout: (async function* () {
          yield new TextEncoder().encode("mocked stdout");
        })(),
        stderr: (async function* () {
          yield new TextEncoder().encode("mocked stderr");
        })(),
        kill: () => {},
      } as any;
    });
  };

  it("does nothing if .superset/config.json is missing", async () => {
    mockSpawn();
    const dir = await mkdtemp(join(tmpdir(), "vibe-scripts-"));
    const logs: string[] = [];
    try {
      await runWorkspaceScripts("setup", dir, "test-repo", (msg) => logs.push(msg));
      expect(logs.length).toBe(0);
      expect(spawnSpy).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs commands from config.json", async () => {
    mockSpawn();
    const dir = await mkdtemp(join(tmpdir(), "vibe-scripts-"));
    const logs: string[] = [];
    try {
      await mkdir(join(dir, ".superset"), { recursive: true });
      await writeFile(
        join(dir, ".superset", "config.json"),
        JSON.stringify({
          setup: ["echo 'setup ran'"],
          teardown: ["echo 'teardown ran'"],
        })
      );

      await runWorkspaceScripts("setup", dir, "test-repo", (msg) => logs.push(msg));
      expect(logs.some((l) => l.includes("Running setup scripts from"))).toBe(true);
      expect(logs).toContain("> echo 'setup ran'");
      expect(logs.some((l) => l.includes("mocked stdout"))).toBe(true);
      expect(logs).toContain("setup scripts completed.");
      expect(spawnSpy).toHaveBeenCalledTimes(1);

      const logsTeardown: string[] = [];
      await runWorkspaceScripts("teardown", dir, "test-repo", (msg) => logsTeardown.push(msg));
      expect(logsTeardown.some((l) => l.includes("Running teardown scripts from"))).toBe(true);
      expect(logsTeardown).toContain("> echo 'teardown ran'");
      expect(logsTeardown.some((l) => l.includes("mocked stdout"))).toBe(true);
      expect(logsTeardown).toContain("teardown scripts completed.");
      expect(spawnSpy).toHaveBeenCalledTimes(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("handles missing phase array", async () => {
    mockSpawn();
    const dir = await mkdtemp(join(tmpdir(), "vibe-scripts-"));
    const logs: string[] = [];
    try {
      await mkdir(join(dir, ".superset"), { recursive: true });
      await writeFile(
        join(dir, ".superset", "config.json"),
        JSON.stringify({
          teardown: ["echo 'teardown ran'"],
        })
      );

      await runWorkspaceScripts("setup", dir, "test-repo", (msg) => logs.push(msg));
      expect(logs.length).toBe(0);
      expect(spawnSpy).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
