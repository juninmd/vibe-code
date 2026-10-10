import { afterEach, describe, expect, mock, test } from "bun:test";
import { runWorkspaceScripts } from "./executor";

const mockSpawn = mock(() => ({
  exited: Promise.resolve(0),
  stdout: new Blob([""]).stream(),
  stderr: new Blob([""]).stream(),
}));

const origSpawn = Bun.spawn;

mock.module("node:fs/promises", () => ({
  access: mock(async (path: string) => {
    if (path.includes("has-setup") && path.includes(".superset/config.json"))
      return Promise.resolve();
    if (path.includes("has-teardown") && path.includes(".superset/config.json"))
      return Promise.resolve();
    if (path.includes("both") && path.includes(".vibe-code/config.json")) return Promise.resolve();
    return Promise.reject(new Error("File not found"));
  }),
  readFile: mock(async (path: string) => {
    if (path.includes("has-setup")) return '{"setup": ["echo setup"]}';
    if (path.includes("has-teardown")) return '{"teardown": ["echo teardown"]}';
    if (path.includes("both")) return '{"setup": ["echo s"], "teardown": ["echo t"]}';
    throw new Error("File not found");
  }),
}));

describe("executor - runWorkspaceScripts", () => {
  afterEach(() => {
    mock.restore();
    Bun.spawn = origSpawn;
  });

  test("runs setup script when present", async () => {
    Bun.spawn = mockSpawn as any;
    const logs: string[] = [];
    await runWorkspaceScripts("setup", "/tmp/has-setup", "repo", (l) => logs.push(l));
    expect(logs).toContain("> echo setup");
  });

  test("runs teardown script when present", async () => {
    Bun.spawn = mockSpawn as any;
    const logs: string[] = [];
    await runWorkspaceScripts("teardown", "/tmp/has-teardown", "repo", (l) => logs.push(l));
    expect(logs).toContain("> echo teardown");
  });

  test("skips if config not present", async () => {
    Bun.spawn = mockSpawn as any;
    const logs: string[] = [];
    await runWorkspaceScripts("setup", "/tmp/no-scripts", "repo", (l) => logs.push(l));
    expect(logs.length).toBe(0);
  });

  test("handles execution failure", async () => {
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
      stdout: new Blob([""]).stream(),
      stderr: new Blob(["fail"]).stream(),
    })) as any;

    const logs: string[] = [];
    await runWorkspaceScripts("setup", "/tmp/has-setup", "repo", (l) => logs.push(l));
    expect(
      logs.some((l) => l.includes("failed to execute")) ||
        logs.some((l) => l.includes("fail")) ||
        logs.some((l) => l.includes("error")) ||
        logs.some((l) => l.includes("exited with non-zero")) ||
        logs.some((l) => l.includes("failed:")) ||
        logs.some((l) => l.includes("Execution failed"))
    ).toBe(true);
  });
});
