import { describe, expect, it } from "vitest";
import {
  absoluteTime,
  fitComposerHeight,
  groupTurns,
  hasNewContent,
  isAtBottom,
  relativeTime,
  type TimelineMessage,
} from "./chatView";

const message = (id: string, role: "user" | "assistant", handoff = false): TimelineMessage => ({
  id,
  role,
  ...(handoff ? { handoff: { from: "a", to: "b" } } : {}),
});

describe("relativeTime", () => {
  const now = Date.parse("2026-11-27T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("counts minutes, hours and days in Portuguese", () => {
    expect(relativeTime(ago(5_000), now)).toBe("agora");
    expect(relativeTime(ago(59_000), now)).toBe("agora");
    expect(relativeTime(ago(60_000), now)).toBe("há 1 min");
    expect(relativeTime(ago(59 * 60_000), now)).toBe("há 59 min");
    expect(relativeTime(ago(60 * 60_000), now)).toBe("há 1 h");
    expect(relativeTime(ago(23 * 60 * 60_000), now)).toBe("há 23 h");
    expect(relativeTime(ago(24 * 60 * 60_000), now)).toBe("há 1 d");
    expect(relativeTime(ago(6 * 24 * 60 * 60_000), now)).toBe("há 6 d");
  });

  it("falls back to the calendar date for older messages", () => {
    expect(relativeTime("2026-11-01T12:00:00Z", now)).toBe("01/11/2026");
  });

  it("renders nothing when the log has no usable timestamp", () => {
    expect(relativeTime(undefined, now)).toBe("");
    expect(relativeTime("not a date", now)).toBe("");
    expect(absoluteTime(undefined)).toBe("");
  });

  it("keeps the full timestamp for the tooltip", () => {
    expect(absoluteTime("2026-11-27T12:34:00Z")).toMatch(/27\/11\/2026/);
  });
});

describe("groupTurns", () => {
  it("merges consecutive assistant segments into one answer", () => {
    const turns = groupTurns([
      message("u1", "user"),
      message("a1", "assistant"),
      message("a2", "assistant"),
      message("a3", "assistant"),
      message("u2", "user"),
      message("a4", "assistant"),
    ]);
    expect(turns.map((turn) => [turn.role, turn.messages.map((m) => m.id)])).toEqual([
      ["user", ["u1"]],
      ["assistant", ["a1", "a2", "a3"]],
      ["user", ["u2"]],
      ["assistant", ["a4"]],
    ]);
  });

  it("never folds an engine takeover into the previous answer", () => {
    const turns = groupTurns([
      message("a1", "assistant"),
      message("h1", "assistant", true),
      message("a2", "assistant"),
    ]);
    expect(turns.map((turn) => [turn.role, turn.messages.map((m) => m.id)])).toEqual([
      ["assistant", ["a1"]],
      ["handoff", ["h1"]],
      ["assistant", ["a2"]],
    ]);
  });
});

describe("scroll anchoring", () => {
  it("follows the bottom within the slack, and stops when the reader scrolls up", () => {
    expect(isAtBottom({ scrollTop: 1_000, scrollHeight: 1_400, clientHeight: 400 })).toBe(true);
    expect(isAtBottom({ scrollTop: 920, scrollHeight: 1_400, clientHeight: 400 })).toBe(true);
    expect(isAtBottom({ scrollTop: 919, scrollHeight: 1_400, clientHeight: 400 })).toBe(false);
  });

  it("only announces content that arrives while the reader is behind", () => {
    expect(hasNewContent(true, 4, 6)).toBe(true);
    expect(hasNewContent(false, 4, 6)).toBe(false);
    expect(hasNewContent(true, 6, 6)).toBe(false);
  });
});

describe("fitComposerHeight", () => {
  it("keeps the resting height and clamps at the viewport cap", () => {
    expect(fitComposerHeight(20, 400)).toBe(46);
    expect(fitComposerHeight(120, 400)).toBe(120);
    expect(fitComposerHeight(900, 400)).toBe(400);
    expect(fitComposerHeight(900, 10)).toBe(46);
  });
});
