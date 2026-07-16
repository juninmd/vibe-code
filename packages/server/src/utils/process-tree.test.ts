import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as child_process from "node:child_process";
import { killProcessTree } from "./process-tree";

describe("killProcessTree", () => {
  let originalPlatform: string;
  let killSpy: any;
  let execSpy: any;

  beforeEach(() => {
    originalPlatform = process.platform;

    execSpy = spyOn(child_process, "exec").mockImplementation(((command: any, ...args: any[]) => {
      const cb = args.pop();
      if (command.startsWith("pgrep -P 1000")) {
        cb(null, "1001\n1002\n", "");
      } else if (command.startsWith("pgrep")) {
        cb(null, "", "");
      } else if (command.startsWith("taskkill")) {
        cb(null, "SUCCESS", "");
      } else {
        cb(null, "", "");
      }
      return {} as any;
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

    await killProcessTree(1000);

    expect(execSpy).toHaveBeenCalled();
    const callArgs = execSpy.mock.calls[0];
    expect(callArgs[0]).toContain("taskkill /F /T /PID 1000");
  });

  test("windows platform gracefully handles taskkill error", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    // Mock error condition for taskkill
    execSpy.mockImplementation((command: any, ...args: any[]) => {
      const cb = args.pop();
      const err = new Error("process already dead");
      (err as any).code = 128;
      cb(err, "", "");
      return {} as any;
    });

    // Should not throw
    await killProcessTree(1000);
    expect(execSpy).toHaveBeenCalled();
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
    killSpy.mockImplementation((pid: number, signal: string) => {
      if (pid === -1000 && killAttempts === 0) {
        killAttempts++;
        throw new Error("No such process group");
      }
      return true;
    });

    await killProcessTree(1000);

    // Ensure exec was called for pgrep
    expect(execSpy).toHaveBeenCalled();
    const execCalls = execSpy.mock.calls;
    const pgrepCall = execCalls.find((call: any) => call[0].includes("pgrep"));
    expect(pgrepCall).toBeDefined();

    // Ensure main pid 1000 was killed
    expect(killSpy).toHaveBeenCalled();
  });
});
