import { describe, expect, it } from "bun:test";
import type { Stats } from "node:fs";
import { resolveOpencodeNativeFromShim } from "./opencode";

const fakeStats = { isFile: () => true } as Stats;

function fakeStat(present: Set<string>) {
  return (p: string) => (present.has(p.replace(/\\/g, "/")) ? fakeStats : null);
}

describe("resolveOpencodeNativeFromShim", () => {
  it("returns null when path is not a .cmd shim", () => {
    expect(
      resolveOpencodeNativeFromShim("/usr/local/bin/opencode", "x64", fakeStat(new Set()))
    ).toBeNull();
  });

  it("prefers x64 native binary when present on x64", () => {
    const shim = "C:/npm/opencode.cmd";
    const native =
      "C:/npm/node_modules/opencode-ai/node_modules/opencode-windows-x64/bin/opencode.exe";
    const result = resolveOpencodeNativeFromShim(shim, "x64", fakeStat(new Set([native])));
    expect(result?.replace(/\\/g, "/")).toBe(native);
  });

  it("falls back to x64-baseline when x64 missing", () => {
    const shim = "C:/npm/opencode.cmd";
    const baseline =
      "C:/npm/node_modules/opencode-ai/node_modules/opencode-windows-x64-baseline/bin/opencode.exe";
    const result = resolveOpencodeNativeFromShim(shim, "x64", fakeStat(new Set([baseline])));
    expect(result?.replace(/\\/g, "/")).toBe(baseline);
  });

  it("prefers arm64 binary on arm64 host", () => {
    const shim = "C:/npm/opencode.cmd";
    const arm =
      "C:/npm/node_modules/opencode-ai/node_modules/opencode-windows-arm64/bin/opencode.exe";
    const result = resolveOpencodeNativeFromShim(shim, "arm64", fakeStat(new Set([arm])));
    expect(result?.replace(/\\/g, "/")).toBe(arm);
  });

  it("returns null when no candidate package is installed", () => {
    expect(
      resolveOpencodeNativeFromShim("C:/npm/opencode.cmd", "x64", fakeStat(new Set()))
    ).toBeNull();
  });
});
