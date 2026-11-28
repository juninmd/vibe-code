import { describe, expect, it } from "bun:test";
import { type BlockedArgs, filterCustomArgs } from "./blocked-args";

const blocked: BlockedArgs = {
  "--format": "with-value",
  "--session": "with-value",
  "--quiet": "standalone",
};

describe("filterCustomArgs", () => {
  it("returns empty for undefined", () => {
    expect(filterCustomArgs(undefined, blocked)).toEqual([]);
  });

  it("passes through allowed args", () => {
    expect(filterCustomArgs(["--verbose", "--retry", "3"], blocked)).toEqual([
      "--verbose",
      "--retry",
      "3",
    ]);
  });

  it("strips with-value blocked flag and its value", () => {
    expect(filterCustomArgs(["--format", "yaml", "--verbose"], blocked)).toEqual(["--verbose"]);
  });

  it("strips with-value blocked flag in inline form", () => {
    expect(filterCustomArgs(["--format=yaml", "--verbose"], blocked)).toEqual(["--verbose"]);
  });

  it("strips standalone blocked flag without consuming next arg", () => {
    expect(filterCustomArgs(["--quiet", "--keep"], blocked)).toEqual(["--keep"]);
  });

  it("invokes onBlock callback per blocked flag", () => {
    const blockedFlags: string[] = [];
    filterCustomArgs(["--format", "json", "--keep", "--quiet"], blocked, (f) =>
      blockedFlags.push(f)
    );
    expect(blockedFlags).toEqual(["--format", "--quiet"]);
  });
});
