import { describe, expect, it } from "vitest";
import { shortenPath, summarizeToolInput } from "./event-summary";

describe("shortenPath", () => {
  it("returns short paths unchanged", () => {
    expect(shortenPath("a.ts")).toBe("a.ts");
    expect(shortenPath("src/main.ts")).toBe("src/main.ts");
    expect(shortenPath("src/lib/foo.ts")).toBe("src/lib/foo.ts");
  });
  it("truncates deep paths to last two segments", () => {
    expect(shortenPath("packages/server/src/agents/engines/opencode.ts")).toBe(
      ".../engines/opencode.ts"
    );
  });
  it("normalizes Windows backslashes", () => {
    expect(shortenPath("a\\b\\c\\d.ts")).toBe(".../c/d.ts");
  });
  it("handles empty input", () => {
    expect(shortenPath("")).toBe("");
  });
});

describe("summarizeToolInput", () => {
  it("returns empty for null/undefined", () => {
    expect(summarizeToolInput(null)).toBe("");
    expect(summarizeToolInput(undefined)).toBe("");
    expect(summarizeToolInput({})).toBe("");
  });
  it("prefers query over path", () => {
    expect(summarizeToolInput({ query: "foo", path: "src/a.ts" })).toBe("foo");
  });
  it("shortens file_path", () => {
    expect(summarizeToolInput({ file_path: "packages/web/src/components/Board.tsx" })).toBe(
      ".../components/Board.tsx"
    );
  });
  it("truncates long commands", () => {
    const cmd = "x".repeat(200);
    expect(summarizeToolInput({ command: cmd }).endsWith("...")).toBe(true);
    expect(summarizeToolInput({ command: cmd }).length).toBeLessThanOrEqual(123);
  });
  it("falls back to first short string", () => {
    expect(summarizeToolInput({ unknown_field: "hello world" })).toBe("hello world");
  });
});
