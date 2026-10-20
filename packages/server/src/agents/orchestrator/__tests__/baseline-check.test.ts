import { describe, expect, it, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { runBaselineCheck } from "../baseline-check";
import * as fsPromises from "node:fs/promises";

describe("runBaselineCheck", () => {
  beforeEach(() => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      return {
        exited: Promise.resolve(0),
        exitCode: 0,
        stdout: new Blob(["mock stdout"]).stream(),
        stderr: new Blob([""]).stream(),
        kill: mock()
      } as any;
    });
  });

  afterEach(() => {
    mock.restore();
    delete process.env.VIBE_CODE_SKIP_BASELINE_CHECK;
  });

  it("should skip if VIBE_CODE_SKIP_BASELINE_CHECK is true", async () => {
    process.env.VIBE_CODE_SKIP_BASELINE_CHECK = "true";
    const result = await runBaselineCheck("/tmp/wt");
    expect(result.skipped).toBe(true);
    expect(result.details).toContain("Skipped");
  });

  it("should skip if no package.json or Makefile is found", async () => {
    spyOn(fsPromises, "access").mockRejectedValue(new Error("ENOENT"));
    const result = await runBaselineCheck("/tmp/wt");
    expect(result.skipped).toBe(true);
    expect(result.details).toContain("No package.json / Makefile found");
  });

  it("should run baseline check if typecheck script is present in package.json", async () => {
    spyOn(fsPromises, "access").mockImplementation(async (path: any) => {
      if (path.toString().endsWith("package.json")) return undefined;
      throw new Error("ENOENT");
    });

    spyOn(fsPromises, "readFile").mockResolvedValue(JSON.stringify({ scripts: { typecheck: "tsc" } }));

    const result = await runBaselineCheck("/tmp/wt");
    expect(result.skipped).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.details).toContain("[✓] bun run typecheck");
  });

  it("should run baseline check if type-check script is present in package.json", async () => {
    spyOn(fsPromises, "access").mockImplementation(async (path: any) => {
      if (path.toString().endsWith("package.json")) return undefined;
      throw new Error("ENOENT");
    });

    spyOn(fsPromises, "readFile").mockResolvedValue(JSON.stringify({ scripts: { "type-check": "tsc" } }));

    const result = await runBaselineCheck("/tmp/wt");
    expect(result.skipped).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.details).toContain("[✓] bun run type-check");
  });

  it("should return null runner if no relevant scripts found", async () => {
    spyOn(fsPromises, "access").mockImplementation(async (path: any) => {
      if (path.toString().endsWith("package.json")) return undefined;
      throw new Error("ENOENT");
    });

    spyOn(fsPromises, "readFile").mockResolvedValue(JSON.stringify({ scripts: { "test": "jest" } }));

    const result = await runBaselineCheck("/tmp/wt");
    expect(result.skipped).toBe(true);
    expect(result.details).toContain("No package.json / Makefile found");
  });

  it("should run baseline check if Makefile is present", async () => {
    spyOn(fsPromises, "access").mockImplementation(async (path: any) => {
      if (path.toString().endsWith("Makefile")) return undefined;
      throw new Error("ENOENT");
    });

    const result = await runBaselineCheck("/tmp/wt");
    expect(result.skipped).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.details).toContain("[✓] make typecheck");
  });

  it("should return false if command fails", async () => {
    spyOn(fsPromises, "access").mockImplementation(async (path: any) => {
      if (path.toString().endsWith("Makefile")) return undefined;
      throw new Error("ENOENT");
    });

    spyOn(Bun, "spawn").mockImplementation(() => {
      return {
        exited: Promise.resolve(1),
        exitCode: 1,
        stdout: new Blob(["failed stdout"]).stream(),
        stderr: new Blob(["failed stderr"]).stream(),
        kill: mock()
      } as any;
    });

    const result = await runBaselineCheck("/tmp/wt");
    expect(result.skipped).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.details).toContain("[✗] make typecheck");
  });

  it("should return false if command throws an exception", async () => {
    spyOn(fsPromises, "access").mockImplementation(async (path: any) => {
      if (path.toString().endsWith("Makefile")) return undefined;
      throw new Error("ENOENT");
    });

    spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("spawn error");
    });

    const result = await runBaselineCheck("/tmp/wt");
    expect(result.skipped).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.details).toContain("[✗] make typecheck");
    expect(result.details).toContain("spawn error");
  });
});
