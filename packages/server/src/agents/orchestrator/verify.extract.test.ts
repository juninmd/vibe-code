import { describe, expect, test } from "bun:test";
import { _formatVerificationResult, extractFailureReason } from "./verify";

describe("executor - verifyWorktree extract/format", () => {
  test("extracts test failures properly", () => {
    const reason = extractFailureReason({
      name: "test",
      command: "cmd",
      source: "workflow",
      exitCode: 1,
      stdout: "some output\nFAIL 1 test failed\nerror",
      stderr: "",
      passed: false,
      reason: null,
    });
    expect(reason).toContain("FAIL 1 test failed");
  });

  test("extracts build error messages properly", () => {
    const reason = extractFailureReason({
      name: "test",
      command: "cmd",
      source: "workflow",
      exitCode: 1,
      stdout: "output\nError: Failed to compile module\nerror",
      stderr: "",
      passed: false,
      reason: null,
    });
    expect(reason).toContain("Error: Failed to compile module");
  });

  test("extracts lint warning messages properly", () => {
    const reason = extractFailureReason({
      name: "test",
      command: "cmd",
      source: "workflow",
      exitCode: 1,
      stdout: "output\nwarning: Unused variable at line 42",
      stderr: "",
      passed: false,
      reason: null,
    });
    expect(reason).toContain("warning: Unused variable at line 42");
  });

  test("falls back to generic failure reason if no match", () => {
    const reason = extractFailureReason({
      name: "test",
      command: "cmd",
      source: "workflow",
      exitCode: 1,
      stdout: "output\nOops something went wrong",
      stderr: "",
      passed: false,
      reason: null,
    });
    expect(reason).toContain("Oops something went wrong");
  });

  test("extracts failure reason exactly as fallback to generic command if no output", () => {
    const reason = extractFailureReason({
      name: "test",
      command: "cmd",
      source: "workflow",
      exitCode: 1,
      stdout: "",
      stderr: "",
      passed: false,
      reason: null,
    });
    expect(reason).toContain("command: cmd");
  });

  test("_formatVerificationResult formats failed results without verbose", () => {
    const reasonText = extractFailureReason({
      name: "test",
      command: "bun test",
      source: "package_json",
      exitCode: 1,
      stdout: "err",
      stderr: "",
      passed: false,
      reason: null,
    });
    const result = _formatVerificationResult(
      {
        name: "test",
        command: "bun test",
        source: "package_json",
        exitCode: 1,
        stdout: "err",
        stderr: "",
        passed: false,
        reason: reasonText,
      },
      false
    );
    expect(result).toBe("  ✗ test: exit 1 — err");
  });

  test("_formatVerificationResult formats failed results with verbose", () => {
    const reasonText = extractFailureReason({
      name: "test",
      command: "bun test",
      source: "package_json",
      exitCode: 1,
      stdout: "line1",
      stderr: "line2",
      passed: false,
      reason: null,
    });
    const result = _formatVerificationResult(
      {
        name: "test",
        command: "bun test",
        source: "package_json",
        exitCode: 1,
        stdout: "line1",
        stderr: "line2",
        passed: false,
        reason: reasonText,
      },
      true
    );
    expect(result).toContain("  ✗ test: exit 1 — line2");
    expect(result).toContain("output: line1\nline2");
  });
});
