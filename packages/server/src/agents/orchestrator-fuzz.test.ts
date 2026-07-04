import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import { resolveMaxAgents } from "../config/max-agents";
import { filterCustomArgs } from "./engines/blocked-args";
import { getHeartbeatIntervalMs } from "./engines/heartbeat";

// --- Local copies of non-exported functions ---

function normalizeAsciiText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E\n\r\t]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function taskSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function splitBufferedLines(buffer: string): { lines: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  return {
    lines: parts.slice(0, -1),
    rest: parts[parts.length - 1] ?? "",
  };
}

// ============================================================
// normalizeAsciiText — property-based fuzz tests
// ============================================================

describe("normalizeAsciiText fuzz", () => {
  it("never throws for any string input", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => normalizeAsciiText(text)).not.toThrow();
      }),
      { numRuns: 1000 }
    );
  });

  it("never returns null", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = normalizeAsciiText(text);
        expect(result).not.toBeNull();
      }),
      { numRuns: 1000 }
    );
  });

  it("result contains only ASCII printable chars, \\n, \\r, \\t", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = normalizeAsciiText(text);
        expect(result).toMatch(/^[\x20-\x7E\n\r\t]*$/);
      }),
      { numRuns: 1000 }
    );
  });

  it("is idempotent — applying twice yields same result", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const once = normalizeAsciiText(text);
        const twice = normalizeAsciiText(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 1000 }
    );
  });

  it("normalized length is never longer than input", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = normalizeAsciiText(text);
        expect(result.length).toBeLessThanOrEqual(text.length);
      }),
      { numRuns: 1000 }
    );
  });
});

// ============================================================
// taskSlug — property-based fuzz tests
// ============================================================

describe("taskSlug fuzz", () => {
  it("never throws for any string input", () => {
    fc.assert(
      fc.property(fc.string(), (title) => {
        expect(() => taskSlug(title)).not.toThrow();
      }),
      { numRuns: 1000 }
    );
  });

  it("returns only lowercase alphanumeric or hyphens", () => {
    fc.assert(
      fc.property(fc.string(), (title) => {
        const slug = taskSlug(title);
        expect(slug).toMatch(/^[a-z0-9-]*$/);
      }),
      { numRuns: 1000 }
    );
  });

  it("never starts or ends with a hyphen", () => {
    fc.assert(
      fc.property(fc.string(), (title) => {
        const slug = taskSlug(title);
        if (slug.length > 0) {
          expect(slug[0]).not.toBe("-");
          expect(slug[slug.length - 1]).not.toBe("-");
        }
      }),
      { numRuns: 1000 }
    );
  });

  it("never exceeds 48 characters", () => {
    fc.assert(
      fc.property(fc.string(), (title) => {
        const slug = taskSlug(title);
        expect(slug.length).toBeLessThanOrEqual(48);
      }),
      { numRuns: 1000 }
    );
  });

  it("is idempotent — applying twice yields same slug", () => {
    fc.assert(
      fc.property(fc.string(), (title) => {
        const once = taskSlug(title);
        const twice = taskSlug(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 1000 }
    );
  });
});

// ============================================================
// filterCustomArgs — property-based fuzz tests
// ============================================================

// ASCII printable chars excluding '=' (0x3D) — used as safe flag/value arbitraries
const asciiNoEqChar = fc
  .integer({ min: 0x21, max: 0x7e })
  .filter((c) => c !== 0x3d)
  .map((c) => String.fromCharCode(c));
const flagString = fc
  .array(asciiNoEqChar, { minLength: 1, maxLength: 16 })
  .map((chars) => chars.join(""));

/** Build a blocked-args record with null prototype to avoid false matches on Object.prototype keys like "toString". */
function nullProtoBlocked(
  flag: string,
  mode: "with-value" | "standalone"
): Record<string, "with-value" | "standalone"> {
  return Object.assign(Object.create(null), { [flag]: mode });
}

describe("filterCustomArgs fuzz", () => {
  it("never throws for any args array", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (args) => {
        expect(() => filterCustomArgs(args, Object.create(null))).not.toThrow();
      }),
      { numRuns: 1000 }
    );
  });

  it("never returns null (always an array)", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (args) => {
        const result = filterCustomArgs(args, Object.create(null));
        expect(Array.isArray(result)).toBe(true);
      }),
      { numRuns: 1000 }
    );
  });

  it("never mutates the original array", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (args) => {
        const snapshot = [...args];
        filterCustomArgs(args, Object.create(null));
        expect(args).toEqual(snapshot);
      }),
      { numRuns: 1000 }
    );
  });

  it("removes blocked with-value flags and their following value", () => {
    fc.assert(
      fc.property(flagString, flagString, (flag, val) => {
        const args = [flag, val];
        const result = filterCustomArgs(args, nullProtoBlocked(flag, "with-value"));
        expect(result).toEqual([]);
      }),
      { numRuns: 1000 }
    );
  });

  it("removes blocked standalone flags but keeps the next value", () => {
    fc.assert(
      fc.property(flagString, flagString, (flag, val) => {
        fc.pre(val !== flag);
        const args = [flag, val];
        const result = filterCustomArgs(args, nullProtoBlocked(flag, "standalone"));
        expect(result).toEqual([val]);
      }),
      { numRuns: 1000 }
    );
  });

  it("passes non-blocked args through unchanged", () => {
    fc.assert(
      fc.property(fc.array(flagString), (args) => {
        const result = filterCustomArgs(args, Object.create(null));
        expect(result).toEqual(args);
      }),
      { numRuns: 1000 }
    );
  });

  it("catches inline '=' format for blocked with-value flags", () => {
    fc.assert(
      fc.property(flagString, flagString, (flag, val) => {
        const inlineArg = `${flag}=${val}`;
        const args = [inlineArg];
        const result = filterCustomArgs(args, nullProtoBlocked(flag, "with-value"));
        expect(result).toEqual([]);
      }),
      { numRuns: 1000 }
    );
  });

  it("returns [] for undefined or empty args", () => {
    expect(filterCustomArgs(undefined, Object.create(null))).toEqual([]);
    expect(filterCustomArgs([], Object.create(null))).toEqual([]);
  });
});

// ============================================================
// resolveMaxAgents — property-based fuzz tests
// ============================================================

const anyInput = fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant(undefined));

describe("resolveMaxAgents fuzz", () => {
  it("always returns an integer >= 1 for any inputs", () => {
    fc.assert(
      fc.property(anyInput, anyInput, (env, stored) => {
        const result = resolveMaxAgents(env, stored);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 1000 }
    );
  });

  it("returns at least 1 even for negative or zero values", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(0),
          fc.constant(-1),
          fc.constant(-100),
          fc.constant("0"),
          fc.constant("-5"),
          fc.constant("NaN"),
          fc.constant("abc")
        ),
        fc.oneof(
          fc.constant(0),
          fc.constant(-1),
          fc.constant(-100),
          fc.constant("0"),
          fc.constant("-5"),
          fc.constant("NaN"),
          fc.constant("abc")
        ),
        (env, stored) => {
          const result = resolveMaxAgents(env, stored);
          expect(result).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("never exceeds env value when stored > 0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        (env, stored) => {
          const result = resolveMaxAgents(env, stored);
          expect(result).toBeLessThanOrEqual(env);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("yields the same result for string and number inputs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        (env, stored) => {
          const numResult = resolveMaxAgents(env, stored);
          const strResult = resolveMaxAgents(String(env), String(stored));
          expect(strResult).toBe(numResult);
        }
      ),
      { numRuns: 1000 }
    );
  });
});

// ============================================================
// getHeartbeatIntervalMs — property-based fuzz tests
// ============================================================

describe("getHeartbeatIntervalMs fuzz", () => {
  it("always returns a positive number", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300000 }), (n) => {
        const prev = process.env.VIBE_CODE_HEARTBEAT_MS;
        process.env.VIBE_CODE_HEARTBEAT_MS = String(n);
        try {
          expect(getHeartbeatIntervalMs()).toBeGreaterThan(0);
        } finally {
          if (prev !== undefined) process.env.VIBE_CODE_HEARTBEAT_MS = prev;
          else delete process.env.VIBE_CODE_HEARTBEAT_MS;
        }
      }),
      { numRuns: 100 }
    );
  });

  it("returns 30000 when env is not set", () => {
    const prev = process.env.VIBE_CODE_HEARTBEAT_MS;
    delete process.env.VIBE_CODE_HEARTBEAT_MS;
    try {
      expect(getHeartbeatIntervalMs()).toBe(30000);
    } finally {
      if (prev !== undefined) process.env.VIBE_CODE_HEARTBEAT_MS = prev;
    }
  });

  it("returns the exact env value when set to a positive integer", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300000 }), (n) => {
        const prev = process.env.VIBE_CODE_HEARTBEAT_MS;
        process.env.VIBE_CODE_HEARTBEAT_MS = String(n);
        try {
          expect(getHeartbeatIntervalMs()).toBe(n);
        } finally {
          if (prev !== undefined) process.env.VIBE_CODE_HEARTBEAT_MS = prev;
          else delete process.env.VIBE_CODE_HEARTBEAT_MS;
        }
      }),
      { numRuns: 100 }
    );
  });

  it("returns 30000 when env is set to a non-positive or invalid value", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant("0"),
          fc.constant("-1"),
          fc.constant("abc"),
          fc.constant(""),
          fc.constant("NaN")
        ),
        (val) => {
          const prev = process.env.VIBE_CODE_HEARTBEAT_MS;
          process.env.VIBE_CODE_HEARTBEAT_MS = val;
          try {
            expect(getHeartbeatIntervalMs()).toBe(30000);
          } finally {
            if (prev !== undefined) process.env.VIBE_CODE_HEARTBEAT_MS = prev;
            else delete process.env.VIBE_CODE_HEARTBEAT_MS;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================
// splitBufferedLines — property-based fuzz tests
// ============================================================

describe("splitBufferedLines fuzz", () => {
  it("always returns {lines: string[], rest: string}", () => {
    fc.assert(
      fc.property(fc.string(), (buffer) => {
        const result = splitBufferedLines(buffer);
        expect(Array.isArray(result.lines)).toBe(true);
        expect(typeof result.rest).toBe("string");
      }),
      { numRuns: 1000 }
    );
  });

  it("lines never contain \\n or \\r", () => {
    fc.assert(
      fc.property(fc.string(), (buffer) => {
        const { lines } = splitBufferedLines(buffer);
        for (const line of lines) {
          expect(line).not.toContain("\n");
          expect(line).not.toContain("\r");
        }
      }),
      { numRuns: 1000 }
    );
  });

  it("for input without \\n, rest equals the input", () => {
    fc.assert(
      fc.property(fc.string(), (buffer) => {
        fc.pre(!buffer.includes("\n"));
        const { rest } = splitBufferedLines(buffer);
        expect(rest).toBe(buffer);
      }),
      { numRuns: 1000 }
    );
  });

  it("splits multiple \\n into multiple lines", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (parts) => {
        fc.pre(parts.length > 0);
        const buffer = parts.join("\n");
        const { lines, rest } = splitBufferedLines(buffer);
        expect(lines.length).toBe(parts.length - 1);
        expect(rest).toBe(parts[parts.length - 1]);
      }),
      { numRuns: 1000 }
    );
  });

  it("preserves content after last \\n as rest", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (prefix, suffix) => {
        const buffer = `${prefix}\n${suffix}`;
        const { lines, rest } = splitBufferedLines(buffer);
        expect(lines).toEqual([prefix]);
        expect(rest).toBe(suffix);
      }),
      { numRuns: 1000 }
    );
  });

  it("handles \\r\\n and standalone \\r as line breaks", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (a, b) => {
        fc.pre(!a.includes("\n") && !a.includes("\r"));
        fc.pre(!b.includes("\n") && !b.includes("\r"));
        const crlf = splitBufferedLines(`${a}\r\n${b}`);
        const cr = splitBufferedLines(`${a}\r${b}`);
        expect(crlf.lines).toEqual([a]);
        expect(crlf.rest).toBe(b);
        expect(cr.lines).toEqual([a]);
        expect(cr.rest).toBe(b);
      }),
      { numRuns: 1000 }
    );
  });

  it("empty buffer returns empty lines and empty rest", () => {
    const { lines, rest } = splitBufferedLines("");
    expect(lines).toEqual([]);
    expect(rest).toBe("");
  });
});
