import { describe, expect, test, mock, afterEach } from "bun:test";

const originalSpawn = Bun.spawn;

mock.module("node:fs/promises", () => ({
  access: mock(async (path: string) => {
    if (path.endsWith("no-pkg/package.json")) return Promise.reject();
    if (path.endsWith("package.json")) return Promise.resolve();

    if (path.includes("bun-proj") && path.endsWith("bun.lock")) return Promise.resolve();
    if (path.includes("pnpm-proj") && path.endsWith("pnpm-lock.yaml")) return Promise.resolve();
    if (path.includes("npm-proj") && path.endsWith("package-lock.json")) return Promise.resolve();

    return Promise.reject(new Error("File not found"));
  }),
}));

import { autoInstallDependencies } from "./executor";

describe("executor - autoInstallDependencies", () => {
  afterEach(() => {
    mock.restore();
    Bun.spawn = originalSpawn;
  });

  test("skips if no package.json", async () => {
    const logs: string[] = [];
    await autoInstallDependencies("/tmp/no-pkg", (m) => logs.push(m));
    expect(logs.length).toBe(0);
  });

  test("uses bun install if bun.lock exists", async () => {
    const logs: string[] = [];
    const mockSpawn = mock(() => ({
      exited: Promise.resolve(0),
      stdout: new Blob([""]).stream(),
      stderr: new Blob([""]).stream(),
    }));
    Bun.spawn = mockSpawn as any;

    await autoInstallDependencies("/tmp/bun-proj", (m) => logs.push(m));
    expect(logs).toContain("Detecting package manager for dependency installation...");
    expect(mockSpawn.mock.calls[0][0]).toEqual(["bun", "install"]);
  });

  test("uses pnpm install if pnpm-lock.yaml exists", async () => {
    const logs: string[] = [];
    const mockSpawn = mock(() => ({
      exited: Promise.resolve(0),
      stdout: new Blob([""]).stream(),
      stderr: new Blob([""]).stream(),
    }));
    Bun.spawn = mockSpawn as any;

    await autoInstallDependencies("/tmp/pnpm-proj", (m) => logs.push(m));
    expect(mockSpawn.mock.calls[0][0]).toEqual(["pnpm", "install"]);
  });

  test("uses npm install if package-lock.json exists", async () => {
    const logs: string[] = [];
    const mockSpawn = mock(() => ({
      exited: Promise.resolve(0),
      stdout: new Blob([""]).stream(),
      stderr: new Blob([""]).stream(),
    }));
    Bun.spawn = mockSpawn as any;

    await autoInstallDependencies("/tmp/npm-proj", (m) => logs.push(m));
    expect(mockSpawn.mock.calls[0][0]).toEqual(["npm", "install"]);
  });

  test("falls back to bun install", async () => {
    const logs: string[] = [];
    const mockSpawn = mock(() => ({
      exited: Promise.resolve(0),
      stdout: new Blob([""]).stream(),
      stderr: new Blob([""]).stream(),
    }));
    Bun.spawn = mockSpawn as any;

    await autoInstallDependencies("/tmp/no-lock", (m) => logs.push(m));
    expect(mockSpawn.mock.calls[0][0]).toEqual(["bun", "install"]);
  });

  test("handles installation failure", async () => {
    const logs: string[] = [];
    const mockSpawn = mock(() => ({
      exited: Promise.resolve(1),
      stdout: new Blob([""]).stream(),
      stderr: new Blob(["failed to install"]).stream(),
    }));
    Bun.spawn = mockSpawn as any;

    await autoInstallDependencies("/tmp/bun-proj", (m) => logs.push(m));
    expect(logs.some(l => l.includes("failed to install"))).toBe(true);
  });

  test("handles spawn error", async () => {
    const logs: string[] = [];
    const mockSpawn = mock(() => {
      throw new Error("Spawn error");
    });
    Bun.spawn = mockSpawn as any;

    await autoInstallDependencies("/tmp/bun-proj", (m) => logs.push(m));
    expect(logs.some(l => l.includes("failed to run install")) || logs.some(l => l.includes("Spawn error"))).toBe(true);
  });
});
