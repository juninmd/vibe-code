import { describe, test, expect, mock, spyOn, afterEach } from "bun:test";
import { _formatVerificationResult, extractFailureReason, verifyWorktreeParallel } from "./verify";
import * as verifyModule from "./verify";

describe("verify utils", () => {
  afterEach(() => {
    mock.restore();
  });

  test("formatVerificationResult with long stdout/stderr correctly truncates", () => {
      const output = _formatVerificationResult({
          command: "bun test",
          exitCode: 1,
          stdout: "A".repeat(10000),
          stderr: "B".repeat(10000),
          name: "test",
          source: "package_json",
          passed: false,
          reason: "unknown"
      }, true);
      expect(output.length).toBeLessThan(15000);
  });

  test("extractFailureReason with missing runner/command should fallback", () => {
      const reason = extractFailureReason({
          command: "bun run foo",
          exitCode: 1,
          stdout: "Some unknown failure output\nThat doesn't match standard patterns",
          stderr: "",
          name: "foo",
          source: "package_json",
          passed: false,
          reason: "unknown"
      });
      expect(reason.includes("exit 1")).toBe(true);
  });

  test("verifyWorktreeParallel abort signal correctly handles failure", async () => {
    spyOn(verifyModule, "discoverValidationCommands").mockResolvedValue([
        {name: "test", command: "bun test", source: "package_json"}
    ]);
    spyOn(Bun, "spawn").mockImplementation((args: any) => {
        return {
            stdout: new ReadableStream({start(c){c.close()}}),
            stderr: new ReadableStream({start(c){c.close()}}),
            exited: Promise.resolve(1),
        } as any;
    });

    const res = await verifyWorktreeParallel("/tmp", (c: string) => {});
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0].exitCode).toBe(1);
  });
});
