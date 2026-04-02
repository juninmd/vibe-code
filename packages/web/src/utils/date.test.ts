import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime } from "./date";

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
