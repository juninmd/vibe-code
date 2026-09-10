import { describe, expect, it } from "vitest";
import { shortenPath, summarizeToolInput } from "./event-summary";

describe("shortenPath", () => {
  it("returns empty string if falsy", () => {
    expect(shortenPath("")).toBe("");
  });

  it("returns full path if 3 or fewer segments", () => {
    expect(shortenPath("a.ts")).toBe("a.ts");
    expect(shortenPath("src/main.ts")).toBe("src/main.ts");
    expect(shortenPath("src/utils/date.ts")).toBe("src/utils/date.ts");
  });

  it("truncates paths with more than 3 segments", () => {
    expect(shortenPath("packages/server/src/agents/engines/opencode.ts")).toBe(
      ".../engines/opencode.ts"
    );
    expect(shortenPath("a/b/c/d.js")).toBe(".../c/d.js");
  });

  it("handles backslashes", () => {
    expect(shortenPath("a\\b\\c\\d.js")).toBe(".../c/d.js");
  });
});

describe("summarizeToolInput", () => {
  it("returns empty string for null or undefined", () => {
    expect(summarizeToolInput(null)).toBe("");
    expect(summarizeToolInput(undefined)).toBe("");
  });

  it("prioritizes query-like fields", () => {
    expect(summarizeToolInput({ query: "find me" })).toBe("find me");
    expect(summarizeToolInput({ pattern: "find me", command: "ls" })).toBe("find me");
    expect(summarizeToolInput({ search: "find me" })).toBe("find me");
    expect(summarizeToolInput({ glob: "*.ts" })).toBe("*.ts");
  });

  it("falls back to path-like fields and shortens them", () => {
    expect(summarizeToolInput({ file_path: "a/b/c/d.ts" })).toBe(".../c/d.ts");
    expect(summarizeToolInput({ path: "a/b/c/d.ts" })).toBe(".../c/d.ts");
    expect(summarizeToolInput({ filename: "a/b/c/d.ts" })).toBe(".../c/d.ts");
    expect(summarizeToolInput({ file: "a.ts" })).toBe("a.ts");
  });

  it("falls back to description", () => {
    expect(summarizeToolInput({ description: "doing something" })).toBe("doing something");
  });

  it("falls back to command and truncates long ones", () => {
    const longCmd = "a".repeat(150);
    expect(summarizeToolInput({ command: "ls -la" })).toBe("ls -la");
    expect(summarizeToolInput({ cmd: longCmd })).toBe(`${"a".repeat(120)}...`);
  });

  it("falls back to prompt and truncates long ones", () => {
    const longPrompt = "p".repeat(150);
    expect(summarizeToolInput({ prompt: "hello" })).toBe("hello");
    expect(summarizeToolInput({ prompt: longPrompt })).toBe(`${"p".repeat(120)}...`);
  });

  it("falls back to skill or name", () => {
    expect(summarizeToolInput({ skill: "my_skill" })).toBe("my_skill");
    expect(summarizeToolInput({ name: "my_name" })).toBe("my_name");
  });

  it("falls back to url", () => {
    expect(summarizeToolInput({ url: "https://example.com" })).toBe("https://example.com");
  });

  it("uses the first valid short string as a final fallback", () => {
    expect(summarizeToolInput({ something: "short fallback", other: 123 })).toBe("short fallback");
  });

  it("ignores empty strings", () => {
    expect(summarizeToolInput({ command: "", name: "valid" })).toBe("valid");
  });

  it("returns empty string if no valid summary found", () => {
    const longFallback = "a".repeat(150);
    expect(summarizeToolInput({ numeric: 123, boolean: true, tooLong: longFallback })).toBe("");
  });
});
