import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

mock.module("playwright", () => ({ chromium: {} }));

import * as fsPromises from "node:fs/promises";
import { autoInstallDependencies, runWorkspaceScripts } from "./executor";

describe("autoInstallDependencies extended", () => {
  beforeEach(() => {
    mock.restore();
    (Bun as any).spawn = mock().mockImplementation((_cmd: string[]) => {
      return {
        stdout: new Blob(["installed\n"]).stream(),
        stderr: new Blob([""]).stream(),
        exited: Promise.resolve(0),
      };
    });
  });

  it("installs dependencies when package.json is found and lockfile indicates pnpm", async () => {
    spyOn(fsPromises, "access").mockImplementation(async (path: any) => {
      if (typeof path === "string") {
        if (path.includes("package.json") || path.includes("pnpm-lock.yaml")) {
          return Promise.resolve(); // exists
        }
      }
      return Promise.reject(new Error("enoent")); // others don't exist
    });

    const logs: string[] = [];
    await autoInstallDependencies("/path/to/wt", (msg) => logs.push(msg));

    expect(
      logs.some((l) => l.includes("Running automatic dependency installation: pnpm install..."))
    ).toBe(true);
  });

  it("handles auto install failures gracefully", async () => {
    spyOn(fsPromises, "access").mockImplementation(async (path: any) => {
      if (typeof path === "string") {
        if (path.includes("package.json") || path.includes("package-lock.json")) {
          return Promise.resolve(); // exists
        }
      }
      return Promise.reject(new Error("enoent")); // others don't exist
    });

    (Bun as any).spawn = mock().mockImplementation((_cmd: string[]) => {
      return {
        stdout: new Blob([""]).stream(),
        stderr: new Blob(["failed to install"]).stream(),
        exited: Promise.resolve(1),
      };
    });

    const logs: string[] = [];
    await autoInstallDependencies("/path/to/wt", (msg) => logs.push(msg));

    expect(
      logs.some((l) => l.includes("Running automatic dependency installation: npm install..."))
    ).toBe(true);
    expect(logs.some((l) => l.includes("failed to install"))).toBe(true);
  });
});

describe("runWorkspaceScripts extended", () => {
  beforeEach(() => {
    mock.restore();
    (Bun as any).spawn = mock().mockImplementation((_cmd: string[]) => {
      return {
        stdout: new Blob(["setup done"]).stream(),
        stderr: new Blob([""]).stream(),
        exited: Promise.resolve(0),
      };
    });
  });

  it("executes setup scripts from config", async () => {
    spyOn(fsPromises, "access").mockImplementation(async (path: any) => {
      if (typeof path === "string" && path.includes(".vibe-code/config.json")) {
        return Promise.resolve(); // exists
      }
      return Promise.reject(new Error("enoent"));
    });

    spyOn(fsPromises, "readFile").mockImplementation(async () => {
      return JSON.stringify({ setup: ["echo setup"] }) as any;
    });

    const logs: string[] = [];
    await runWorkspaceScripts("setup", "/path/to/wt", "my-repo", (msg) => logs.push(msg));

    expect(logs.some((l) => l.includes("> echo setup"))).toBe(true);
  });

  it("fails execution script gracefully", async () => {
    spyOn(fsPromises, "access").mockImplementation(async (path: any) => {
      if (typeof path === "string" && path.includes(".vibe-code/config.json")) {
        return Promise.resolve(); // exists
      }
      return Promise.reject(new Error("enoent"));
    });

    spyOn(fsPromises, "readFile").mockImplementation(async () => {
      return JSON.stringify({ setup: ["echo setup"] }) as any;
    });

    (Bun as any).spawn = mock().mockImplementation((_cmd: string[]) => {
      return {
        stdout: new Blob([""]).stream(),
        stderr: new Blob(["error happened"]).stream(),
        exited: Promise.resolve(1),
      };
    });

    const logs: string[] = [];
    await runWorkspaceScripts("setup", "/path/to/wt", "my-repo", (msg) => logs.push(msg));

    expect(logs.some((l) => l.includes("> echo setup"))).toBe(true);
    expect(logs.some((l) => l.includes("setup script 'echo setup' failed with exit code 1"))).toBe(
      true
    );
  });
});
