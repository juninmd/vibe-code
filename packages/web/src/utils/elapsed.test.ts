import { describe, expect, it } from "vitest";
import { formatElapsedMs, formatElapsedSecs } from "./elapsed";

describe("formatElapsedSecs", () => {
  it("formats sub-minute as Ns", () => {
    expect(formatElapsedSecs(0)).toBe("0s");
    expect(formatElapsedSecs(59)).toBe("59s");
  });
  it("drops seconds on round minutes", () => {
    expect(formatElapsedSecs(60)).toBe("1m");
    expect(formatElapsedSecs(180)).toBe("3m");
  });
  it("formats Nm Ms for non-round minutes", () => {
    expect(formatElapsedSecs(61)).toBe("1m 1s");
    expect(formatElapsedSecs(125)).toBe("2m 5s");
  });
});

describe("formatElapsedMs", () => {
  it("converts ms to secs and clamps negatives", () => {
    expect(formatElapsedMs(0)).toBe("0s");
    expect(formatElapsedMs(-500)).toBe("0s");
    expect(formatElapsedMs(60_000)).toBe("1m");
    expect(formatElapsedMs(125_500)).toBe("2m 6s");
  });
});
