import { describe, expect, it } from "vitest";
import { formatElapsedMs, formatElapsedSecs } from "./elapsed";

describe("formatElapsedSecs", () => {
  it("formats seconds correctly", () => {
    expect(formatElapsedSecs(0)).toBe("0s");
    expect(formatElapsedSecs(45)).toBe("45s");
    expect(formatElapsedSecs(59)).toBe("59s");
  });

  it("formats exact minutes correctly without seconds", () => {
    expect(formatElapsedSecs(60)).toBe("1m");
    expect(formatElapsedSecs(120)).toBe("2m");
  });

  it("formats minutes and seconds correctly", () => {
    expect(formatElapsedSecs(61)).toBe("1m 1s");
    expect(formatElapsedSecs(125)).toBe("2m 5s");
  });
});

describe("formatElapsedMs", () => {
  it("formats ms correctly", () => {
    expect(formatElapsedMs(0)).toBe("0s");
    expect(formatElapsedMs(500)).toBe("1s");
    expect(formatElapsedMs(1000)).toBe("1s");
    expect(formatElapsedMs(45000)).toBe("45s");
    expect(formatElapsedMs(60000)).toBe("1m");
    expect(formatElapsedMs(61000)).toBe("1m 1s");
  });

  it("rounds correctly", () => {
    expect(formatElapsedMs(499)).toBe("0s");
    expect(formatElapsedMs(500)).toBe("1s");
    expect(formatElapsedMs(1499)).toBe("1s");
    expect(formatElapsedMs(1500)).toBe("2s");
  });

  it("handles negative ms as 0s", () => {
    expect(formatElapsedMs(-1000)).toBe("0s");
    expect(formatElapsedMs(-500)).toBe("0s");
  });
});
