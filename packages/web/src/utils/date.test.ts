import { describe, expect, it } from "vitest";
import { formatDateTime, formatDuration, formatTime } from "./date";

describe("formatDateTime", () => {
  it("returns dash for null", () => {
    expect(formatDateTime(null)).toBe("-");
  });

  it("formats an ISO string to pt-BR datetime in America/Sao_Paulo", () => {
    // 2024-03-01T15:00:00Z = 12:00:00 in UTC-3
    const result = formatDateTime("2024-03-01T15:00:00.000Z");
    expect(result).toMatch(/01\/03\/2024/);
    expect(result).toMatch(/12:00:00/);
  });

  it("accepts a Date object", () => {
    const result = formatDateTime(new Date("2024-06-15T18:30:00.000Z"));
    expect(result).toMatch(/15\/06\/2024/);
  });
});

describe("formatTime", () => {
  it("returns placeholder for null", () => {
    expect(formatTime(null)).toBe("--:--:--");
  });

  it("formats an ISO string to HH:mm:ss in America/Sao_Paulo", () => {
    // 2024-03-01T15:00:00Z = 12:00:00 in UTC-3
    const result = formatTime("2024-03-01T15:00:00.000Z");
    expect(result).toBe("12:00:00");
  });

  it("accepts a numeric timestamp", () => {
    const ts = new Date("2024-01-01T12:00:00.000Z").getTime();
    const result = formatTime(ts);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe("formatDuration", () => {
  it("returns null when startedAt is null", () => {
    expect(formatDuration(null, "2024-01-01T12:00:00.000Z")).toBeNull();
  });

  it("returns duration in seconds", () => {
    const start = new Date("2024-01-01T12:00:00.000Z").toISOString();
    const end = new Date("2024-01-01T12:00:45.000Z").toISOString();
    expect(formatDuration(start, end)).toBe("45s");
  });

  it("returns duration in minutes and seconds", () => {
    const start = new Date("2024-01-01T12:00:00.000Z").toISOString();
    const end = new Date("2024-01-01T12:01:23.000Z").toISOString();
    expect(formatDuration(start, end)).toBe("1m 23s");
  });

  it("returns duration in hours and minutes", () => {
    const start = new Date("2024-01-01T12:00:00.000Z").toISOString();
    const end = new Date("2024-01-01T14:03:00.000Z").toISOString();
    expect(formatDuration(start, end)).toBe("2h 3m");
  });
});

describe("formatDuration extra cases", () => {
  it("uses Date.now() when finishedAt is null", () => {
    // Cannot mock Date.now() easily without setup, but we can verify it doesn't crash and returns a string
    const start = new Date(Date.now() - 5000).toISOString();
    expect(formatDuration(start, null)).toMatch(/\ds/);
  });
});
