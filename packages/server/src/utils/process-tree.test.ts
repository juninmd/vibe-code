import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as util from "node:util";
import { killProcessTree } from "./process-tree";

describe("killProcessTree", () => {
  let originalPlatform: string;
  let killSpy: any;
  let promisifySpy: any;

  // Suppress console.debug output in test output for clean runs
  let debugSpy: any;

  beforeEach(() => {
    originalPlatform = process.platform;
    debugSpy = spyOn(console, "debug").mockImplementation(() => {});

    // We mock promisify directly to bypass the callback hell
    promisifySpy = spyOn(util, "promisify").mockImplementation(((_fn: any) => {
      return async (command: string) => {
        if (command.startsWith("pgrep -P 1000")) {
          return { stdout: "1001\n1002\n" };
        } else if (command.startsWith("pgrep")) {
          return { stdout: "" };
        } else if (command.startsWith("taskkill")) {
          return { stdout: "SUCCESS" };
        }
        return { stdout: "" };
      };
    }) as any);

    killSpy = spyOn(process, "kill").mockImplementation(() => {
      return true;
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    mock.restore();
  });

  test("windows platform runs taskkill", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    let calledCommand = "";
    promisifySpy.mockImplementation(() => {
      return async (command: string) => {
        calledCommand = command;
        return { stdout: "" };
      };
    });

    await killProcessTree(1000);

    expect(calledCommand).toContain("taskkill /F /T /PID 1000");
  });

  test("windows platform gracefully handles taskkill error", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    promisifySpy.mockImplementation(() => {
      return async () => {
        // Return rejected promise to simulate exec failure
        // We use a simple object instead of an actual Error instance
        // to prevent `bun test` unhandled rejection hooks from catching it globally
        return Promise.reject({ message: "process already dead", code: 128 });
      };
    });

    // Should not throw
    await killProcessTree(1000);
    expect(true).toBe(true);
  });

  test("unix platform attempts process group kill first", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    await killProcessTree(1000);

    expect(killSpy).toHaveBeenCalled();
    expect(killSpy.mock.calls[0]).toEqual([-1000, "SIGKILL"]);
  });

  test("unix platform falls back to recursive pgrep and kill if group kill fails", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    let killAttempts = 0;
    killSpy.mockImplementation((pid: number, _signal: string) => {
      if (pid === -1000 && killAttempts === 0) {
        killAttempts++;
        throw new Error("No such process group");
      }
      return true;
    });

    let pgrepCalled = false;
    promisifySpy.mockImplementation(() => {
      return async (command: string) => {
        if (command.includes("pgrep")) {
          pgrepCalled = true;
          return { stdout: "" };
        }
        return { stdout: "" };
      };
    });

    await killProcessTree(1000);

    expect(pgrepCalled).toBe(true);
    expect(killSpy).toHaveBeenCalled();
  });

  test("unix platform logs debug on fallback execution error", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    let killAttempts = 0;
    killSpy.mockImplementation((pid: number, _signal: string) => {
      if (pid === -1000 && killAttempts === 0) {
        killAttempts++;
        throw new Error("No such process group");
      }
      return true;
    });

    promisifySpy.mockImplementation(() => {
      return async () => {
        return Promise.reject({ message: "pgrep failed" });
      };
    });

    // Should catch the error internally and just log
    await killProcessTree(1000);
    expect(debugSpy).toHaveBeenCalled();
  });
});
