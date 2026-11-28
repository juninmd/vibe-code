import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relative-time";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const ago = (secs: number) => new Date(NOW - secs * 1000).toISOString();

describe("formatRelativeTime", () => {
  it("returns empty for missing or invalid input", () => {
    expect(formatRelativeTime(null, NOW)).toBe("");
    expect(formatRelativeTime("not a date", NOW)).toBe("");
  });

  it("treats future timestamps (clock skew) as just now", () => {
    expect(formatRelativeTime(ago(-120), NOW)).toBe("just now");
  });

  it("uses the next unit instead of '60m' or '24h' at the rounding edge", () => {
    expect(formatRelativeTime(ago(59 * 60 + 40), NOW)).toBe("1h ago");
    expect(formatRelativeTime(ago(23 * 3600 + 45 * 60), NOW)).toBe("1d ago");
  });

  it("switches to a calendar date once rounding reaches a week", () => {
    expect(formatRelativeTime(ago(6 * 86400 + 13 * 3600), NOW)).toMatch(/^Nov 1[34]$/);
  });

  it("keeps ordinary values in their unit", () => {
    expect(formatRelativeTime(ago(30), NOW)).toBe("just now");
    expect(formatRelativeTime(ago(5 * 60), NOW)).toBe("5m ago");
    expect(formatRelativeTime(ago(3 * 3600), NOW)).toBe("3h ago");
    expect(formatRelativeTime(ago(2 * 86400), NOW)).toBe("2d ago");
  });
});
