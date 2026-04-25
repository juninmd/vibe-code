import { expect, test, describe, mock, spyOn, afterEach, beforeEach } from "bun:test";
import { runBaselineCheck } from "./baseline-check";
import * as fs from "node:fs/promises";
import * as path from "node:path";

describe("runBaselineCheck", () => {
  let spawnSpy: ReturnType<typeof spyOn>;
  let accessSpy: ReturnType<typeof spyOn>;
  let readFileSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Enable baseline check
    process.env.VIBE_CODE_SKIP_BASELINE_CHECK = "false";

    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: any) => {
      return {
        exited: Promise.resolve(0),
        exitCode: 0,
        stdout: new Blob(["Type check passed"]).stream(),
        stderr: new Blob([""]).stream(),
      } as any;
    });

    accessSpy = spyOn(fs, "access").mockImplementation(async () => {});

    readFileSpy = spyOn(fs, "readFile").mockImplementation(async () => {
      return JSON.stringify({
        scripts: {
          typecheck: "tsc --noEmit",
        },
      });
    });
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    accessSpy.mockRestore();
    readFileSpy.mockRestore();
    delete process.env.VIBE_CODE_SKIP_BASELINE_CHECK;
  });

  test("skips if VIBE_CODE_SKIP_BASELINE_CHECK is true", async () => {
    process.env.VIBE_CODE_SKIP_BASELINE_CHECK = "true";
    const result = await runBaselineCheck("/wt");

    expect(result).toEqual({
      passed: true,
      skipped: true,
      details: "Skipped via VIBE_CODE_SKIP_BASELINE_CHECK",
    });

    expect(accessSpy).not.toHaveBeenCalled();
  });

  test("skips if no runner is detected (no package.json or Makefile)", async () => {
    accessSpy.mockImplementation(async () => {
      throw new Error("ENOENT");
    });

    const result = await runBaselineCheck("/wt");

    expect(result).toEqual({
      passed: true,
      skipped: true,
      details: "No package.json / Makefile found — baseline check skipped",
    });
  });

  test("detects make and runs make typecheck", async () => {
    accessSpy.mockImplementation(async (filepath: string) => {
      if (filepath.endsWith("package.json")) throw new Error("ENOENT");
      // Allow Makefile
    });

    const result = await runBaselineCheck("/wt");

    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.details).toContain("[✓] make typecheck");
    expect(result.details).toContain("Type check passed");

    expect(spawnSpy).toHaveBeenCalledWith(["make", "typecheck"], expect.any(Object));
  });

  test("detects package.json but skips if no typecheck script", async () => {
    readFileSpy.mockImplementation(async () => {
      return JSON.stringify({
        scripts: {
          test: "jest",
        },
      });
    });

    const result = await runBaselineCheck("/wt");

    expect(result).toEqual({
      passed: true,
      skipped: true,
      details: "No package.json / Makefile found — baseline check skipped",
    });
  });

  test("detects type-check script in package.json", async () => {
    readFileSpy.mockImplementation(async () => {
      return JSON.stringify({
        scripts: {
          "type-check": "tsc --noEmit",
        },
      });
    });

    const result = await runBaselineCheck("/wt");

    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.details).toContain("[✓] bun run type-check");

    expect(spawnSpy).toHaveBeenCalledWith(["bun", "run", "type-check"], expect.any(Object));
  });

  test("fails if runner command fails", async () => {
    spawnSpy.mockImplementation((args: any) => {
      return {
        exited: Promise.resolve(1),
        exitCode: 1,
        stdout: new Blob([""]).stream(),
        stderr: new Blob(["Type error"]).stream(),
      } as any;
    });

    const result = await runBaselineCheck("/wt");

    expect(result.passed).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.details).toContain("[✗] bun run typecheck");
    expect(result.details).toContain("Type error");
  });

  test("handles JSON parse error gracefully", async () => {
    readFileSpy.mockImplementation(async () => {
      return "invalid json";
    });

    // Should fall back to checking Makefile
    accessSpy.mockImplementation(async (filepath: string) => {
      if (filepath.endsWith("Makefile")) throw new Error("ENOENT");
    });

    const result = await runBaselineCheck("/wt");

    expect(result).toEqual({
      passed: true,
      skipped: true,
      details: "No package.json / Makefile found — baseline check skipped",
    });
  });

  test("handles spawn errors gracefully", async () => {
    spawnSpy.mockImplementation(() => {
      throw new Error("Command not found");
    });

    const result = await runBaselineCheck("/wt");

    expect(result.passed).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.details).toContain("[✗] bun run typecheck");
    expect(result.details).toContain("Command not found");
  });

  test("truncates output to last 10 lines", async () => {
    const longOutput = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join("\n");

    spawnSpy.mockImplementation((args: any) => {
      return {
        exited: Promise.resolve(0),
        exitCode: 0,
        stdout: new Blob([longOutput]).stream(),
        stderr: new Blob([""]).stream(),
      } as any;
    });

    const result = await runBaselineCheck("/wt");

    expect(result.passed).toBe(true);
    expect(result.details).not.toContain("Line 10\n"); // Line 10 isn't in the last 10 lines
    expect(result.details).toContain("Line 11"); // Start of the last 10 lines
    expect(result.details).toContain("Line 20");
  });

  test("runner process handles exit timeout (or unresolved exited)", async () => {
    // Instead of completely hanging (which might actually hang the test),
    // we simulate the timeout condition by immediately resolving the timeout promise
    // but without throwing - the ok flag will be derived from exitCode = undefined (defaulting to 1 => false).

    spawnSpy.mockImplementation((args: any) => {
      return {
        // A promise that doesn't resolve immediately
        exited: new Promise((resolve) => setTimeout(resolve, 100)),
        exitCode: undefined, // Simulates an aborted/killed process
        stdout: new Blob([""]).stream(),
        stderr: new Blob([""]).stream(),
      } as any;
    });

    // To prevent the test from taking 60s, we mock global.setTimeout
    const originalSetTimeout = global.setTimeout;
    (global as any).setTimeout = (cb: any) => cb(); // Execute immediately

    const result = await runBaselineCheck("/wt");

    (global as any).setTimeout = originalSetTimeout;

    // Command failed due to not exiting with code 0
    expect(result.passed).toBe(false);
    expect(result.details).toContain("[✗]");
  });
});
