import { describe, expect, it } from "bun:test";
import { EventDedup } from "./event-dedup";

describe("EventDedup", () => {
  it("delivers first occurrence, drops repeats", () => {
    const d = new EventDedup();
    expect(d.markSeen("a")).toBe(true);
    expect(d.markSeen("a")).toBe(false);
    expect(d.markSeen("b")).toBe(true);
    expect(d.markSeen("a")).toBe(false);
  });

  it("treats empty/undefined id as always-deliver (no dedup)", () => {
    const d = new EventDedup();
    expect(d.markSeen("")).toBe(true);
    expect(d.markSeen(undefined)).toBe(true);
    expect(d.markSeen(null)).toBe(true);
    expect(d.size()).toBe(0);
  });

  it("evicts oldest id once capacity exceeded (FIFO)", () => {
    const d = new EventDedup(3);
    d.markSeen("a");
    d.markSeen("b");
    d.markSeen("c");
    d.markSeen("d"); // evicts "a"; buffer = [b,c,d]
    expect(d.size()).toBe(3);
    // "a" was evicted, so it counts as new again
    expect(d.markSeen("a")).toBe(true);
    // "c" still in buffer (it was [b,c,d] then [c,d,a])
    expect(d.markSeen("c")).toBe(false);
  });

  it("clear() resets the buffer", () => {
    const d = new EventDedup();
    d.markSeen("x");
    d.clear();
    expect(d.markSeen("x")).toBe(true);
    expect(d.size()).toBe(1);
  });
});
