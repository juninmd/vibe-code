import { describe, expect, test } from "bun:test";
import { _formatVerificationResult } from "./verify";

describe("executor - _formatVerificationResult", () => {
  test("formats successful results", () => {
    const result = _formatVerificationResult(
      { name: "test", command: "bun test", source: "package_json", exitCode: 0, stdout: "passed", stderr: "", passed: true, reason: "passed" },
      false
    );
    expect(result).toBe("  ✓ test");
  });

  test("formats failed results without verbose", () => {
    const result = _formatVerificationResult(
      { name: "test", command: "bun test", source: "package_json", exitCode: 1, stdout: "err", stderr: "", passed: false, reason: "exit 1 — error" },
      false
    );
    expect(result).toBe("  ✗ test: exit 1 — err");
  });

  test("formats failed results with verbose", () => {
    const result = _formatVerificationResult(
      { name: "test", command: "bun test", source: "package_json", exitCode: 1, stdout: "line1", stderr: "line2", passed: false, reason: "exit 1 — error" },
      true
    );
    expect(result).toContain("  ✗ test: exit 1 — line2");
    expect(result).toContain("output: line1\nline2");
  });
});
