import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import * as util from "node:util";
import { killProcessTree } from "../process-tree";

describe("killProcessTree", () => {
  let processPlatform: string;

  beforeEach(() => {
    processPlatform = process.platform;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: processPlatform });
    mock.restore();
  });

  it("should use taskkill on Windows", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    // We cannot mock promisify(exec) directly easily since it's defined inside the function.
    // Instead, we will spy on util.promisify itself to intercept what it returns.
    const mockExecAsync = mock().mockResolvedValue({ stdout: "", stderr: "" });
    spyOn(util, "promisify").mockReturnValue(mockExecAsync as any);

    await killProcessTree(1234);

    expect(util.promisify).toHaveBeenCalledWith(childProcess.exec);
    expect(mockExecAsync).toHaveBeenCalledWith("taskkill /F /T /PID 1234");
  });

  it("should handle taskkill failure gracefully", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    const mockExecAsync = mock().mockRejectedValue(new Error("taskkill failed"));
    spyOn(util, "promisify").mockReturnValue(mockExecAsync as any);
    const debugSpy = spyOn(console, "debug").mockImplementation(() => {});

    await killProcessTree(1234);

    expect(mockExecAsync).toHaveBeenCalledWith("taskkill /F /T /PID 1234");
    expect(debugSpy).toHaveBeenCalled();
  });

  it("should use process.kill with negative pid on Unix", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    const killSpy = spyOn(process, "kill").mockImplementation(() => true);

    await killProcessTree(1234);

    expect(killSpy).toHaveBeenCalledWith(-1234, "SIGKILL");
  });

  it("should fallback to recursive pgrep on Unix if process group kill fails", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    const killSpy = spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === -1234) throw new Error("no group kill");
      if (pid === -5678) throw new Error("no group kill for child");
      return true;
    });

    const mockExecAsync = mock().mockImplementation(async (cmd) => {
      if (cmd === "pgrep -P 1234") return { stdout: "5678\n" };
      if (cmd === "pgrep -P 5678") return { stdout: "" };
      return { stdout: "" };
    });

    spyOn(util, "promisify").mockReturnValue(mockExecAsync as any);

    await killProcessTree(1234);

    expect(killSpy).toHaveBeenCalledWith(-1234, "SIGKILL");
    expect(mockExecAsync).toHaveBeenCalledWith("pgrep -P 1234");
    // Also tried to kill child process 5678
    expect(killSpy).toHaveBeenCalledWith(-5678, "SIGKILL");
    expect(mockExecAsync).toHaveBeenCalledWith("pgrep -P 5678");
    expect(killSpy).toHaveBeenCalledWith(1234, "SIGKILL");
  });

  it("should gracefully handle fallback errors", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    const killSpy = spyOn(process, "kill").mockImplementation(() => {
      throw new Error("kill failed");
    });

    const mockExecAsync = mock().mockRejectedValue(new Error("pgrep failed"));
    spyOn(util, "promisify").mockReturnValue(mockExecAsync as any);
    const debugSpy = spyOn(console, "debug").mockImplementation(() => {});

    await killProcessTree(1234);

    expect(killSpy).toHaveBeenCalledWith(-1234, "SIGKILL");
    expect(mockExecAsync).toHaveBeenCalledWith("pgrep -P 1234");
    expect(debugSpy).toHaveBeenCalled();
  });
});
