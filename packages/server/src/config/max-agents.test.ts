import { describe, expect, it } from "bun:test";
import { resolveMaxAgents } from "./max-agents";

describe("resolveMaxAgents", () => {
  it("uses the env default when no stored value exists", () => {
    expect(resolveMaxAgents(undefined, undefined)).toBe(4);
  });

  it("caps a stored value by the env cap", () => {
    expect(resolveMaxAgents("1", "4")).toBe(1);
  });

  it("preserves a lower stored value under the env cap", () => {
    expect(resolveMaxAgents("4", "2")).toBe(2);
  });

  it("ignores invalid values", () => {
    expect(resolveMaxAgents("not-a-number", "0")).toBe(4);
  });
});
