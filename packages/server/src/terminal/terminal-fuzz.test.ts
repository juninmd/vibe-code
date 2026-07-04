import { describe, expect, it } from "bun:test";
import fc from "fast-check";

// ── replicated internal logic ──────────────────────────────────────────────

const MAX_INPUT_BYTES_PER_MESSAGE = 4_096;
const MAX_INPUT_BYTES_PER_SECOND = 16_384;
const RATE_LIMIT_WINDOW_MS = 1_000;

interface RateLimitState {
  windowStartedAt: number;
  stdinBytesInWindow: number;
}

function resolveShellCommandImpl(platform: string, shellEnv: string | undefined): string[] {
  if (platform === "win32") {
    return ["powershell.exe", "-NoLogo"];
  }
  const shell = shellEnv?.trim();
  if (shell) return [shell];
  return ["/bin/bash"];
}

function checkRateLimit(
  input: string,
  state: RateLimitState,
  now: number
): { ok: boolean; reason?: string } {
  const bytes = Buffer.byteLength(input, "utf8");
  if (bytes > MAX_INPUT_BYTES_PER_MESSAGE) {
    return { ok: false, reason: "payload_too_large" };
  }
  if (now - state.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    return { ok: true };
  }
  if (state.stdinBytesInWindow + bytes > MAX_INPUT_BYTES_PER_SECOND) {
    return { ok: false, reason: "rate_limited" };
  }
  return { ok: true };
}

function applyResize(cols: number, rows: number): { cols: number; rows: number } {
  return { cols: Math.max(20, cols), rows: Math.max(5, rows) };
}

function resolveSignal(signal: string): "SIGINT" | "SIGTERM" | "SIGHUP" {
  if (signal === "sigint") return "SIGINT";
  if (signal === "sigterm") return "SIGTERM";
  return "SIGHUP";
}

// ── helpers ────────────────────────────────────────────────────────────────

function nearBytesStringArbitrary(minLen: number, maxLen: number): fc.Arbitrary<string> {
  return fc.integer({ min: minLen, max: maxLen }).map((n) => "a".repeat(n));
}

// ── fuzz tests ────────────────────────────────────────────────────────────

describe("TerminalSessionService internal logic (fuzz)", () => {
  // ── resolveShellCommand ────────────────────────────────────────────────

  it("resolveShellCommand never throws for any platform or shell env", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("win32", "linux", "darwin", "freebsd", "aix", "sunos"),
        fc.option(fc.string(), { nil: undefined }),
        (platform, shell) => {
          expect(() => resolveShellCommandImpl(platform, shell)).not.toThrow();
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("resolveShellCommand returns string[] with at least 1 element", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("win32", "linux", "darwin"),
        fc.oneof(fc.constant(undefined), fc.string()),
        (platform, shell) => {
          const result = resolveShellCommandImpl(platform, shell);
          expect(Array.isArray(result)).toBe(true);
          expect(result.length).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("resolveShellCommand first element is always a non-empty string", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("win32", "linux", "darwin"),
        fc.oneof(fc.constant(undefined), fc.string()),
        (platform, shell) => {
          const result = resolveShellCommandImpl(platform, shell);
          expect(typeof result[0]).toBe("string");
          expect(result[0].length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("resolveShellCommand on win32 always returns powershell.exe -NoLogo", () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: undefined }), (shell) => {
        expect(resolveShellCommandImpl("win32", shell)).toEqual(["powershell.exe", "-NoLogo"]);
      }),
      { numRuns: 200 }
    );
  });

  it("resolveShellCommand on non-win32 returns the trimmed shell env when set", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        (shell) => {
          const result = resolveShellCommandImpl("linux", shell);
          expect(result[0]).toBe(shell.trim());
          expect(result.length).toBe(1);
        }
      ),
      { numRuns: 200 }
    );
  });

  // ── rate limiting ──────────────────────────────────────────────────────

  it("sendInput rejects strings over 4096 bytes with payload_too_large", () => {
    fc.assert(
      fc.property(nearBytesStringArbitrary(4097, 5000), (input) => {
        const now = Date.now();
        const state: RateLimitState = {
          windowStartedAt: now,
          stdinBytesInWindow: 0,
        };
        const result = checkRateLimit(input, state, now);
        expect(result).toEqual({
          ok: false,
          reason: "payload_too_large",
        });
      }),
      { numRuns: 100 }
    );
  });

  it("sendInput accepts exactly 4096 bytes (borderline) when window is fresh", () => {
    fc.assert(
      fc.property(fc.constant("a".repeat(4096)), (input) => {
        expect(Buffer.byteLength(input, "utf8")).toBe(4096);
        const now = Date.now();
        const state: RateLimitState = {
          windowStartedAt: now,
          stdinBytesInWindow: 0,
        };
        const result = checkRateLimit(input, state, now);
        expect(result.ok).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it("sendInput accepts any input under or equal to 4096 bytes with fresh window", () => {
    fc.assert(
      fc.property(nearBytesStringArbitrary(0, 4096), (input) => {
        const bytes = Buffer.byteLength(input, "utf8");
        expect(bytes).toBeLessThanOrEqual(MAX_INPUT_BYTES_PER_MESSAGE);
        const now = Date.now();
        const state: RateLimitState = {
          windowStartedAt: now,
          stdinBytesInWindow: 0,
        };
        const result = checkRateLimit(input, state, now);
        expect(result.ok).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it("cumulative bytes > 16384 in same window returns rate_limited", () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.integer({ min: 1, max: MAX_INPUT_BYTES_PER_SECOND }),
            fc.integer({ min: 1, max: MAX_INPUT_BYTES_PER_MESSAGE })
          )
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          .filter(([windowBytes, inputBytes]) => {
            // Use plain ASCII 'a' so byteLength === inputBytes
            return windowBytes + inputBytes > MAX_INPUT_BYTES_PER_SECOND;
          }),
        ([windowBytes, inputBytes]) => {
          const input = "a".repeat(inputBytes);
          const now = Date.now();
          const state: RateLimitState = {
            windowStartedAt: now,
            stdinBytesInWindow: windowBytes,
          };
          const result = checkRateLimit(input, state, now);
          expect(result).toEqual({ ok: false, reason: "rate_limited" });
        }
      ),
      { numRuns: 500 }
    );
  });

  it("rate limit window resets after 1000ms has elapsed", () => {
    fc.assert(
      fc.property(nearBytesStringArbitrary(0, 4096), (input) => {
        const oldState: RateLimitState = {
          windowStartedAt: Date.now() - 2000,
          stdinBytesInWindow: MAX_INPUT_BYTES_PER_SECOND,
        };
        const result = checkRateLimit(input, oldState, Date.now());
        expect(result.ok).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it("empty string (0 bytes) is always accepted regardless of window state", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_INPUT_BYTES_PER_SECOND }),
        fc.integer({ min: 0, max: 2000 }),
        (windowBytes, windowAge) => {
          const now = Date.now();
          const state: RateLimitState = {
            windowStartedAt: now - windowAge,
            stdinBytesInWindow: windowBytes,
          };
          const result = checkRateLimit("", state, now);
          expect(result.ok).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("byteLength of generated input always matches expected size for ASCII", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), (n) => {
        const input = "a".repeat(n);
        expect(Buffer.byteLength(input, "utf8")).toBe(n);
      }),
      { numRuns: 500 }
    );
  });

  // ── resize clamping ──────────────────────────────────────────────────

  it("resize clamps cols to >= 20 and rows to >= 5 for any numeric input", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000, max: 100_000 }),
        fc.integer({ min: -100_000, max: 100_000 }),
        (cols, rows) => {
          const result = applyResize(cols, rows);
          expect(result.cols).toBeGreaterThanOrEqual(20);
          expect(result.rows).toBeGreaterThanOrEqual(5);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("resize preserves values already at or above minimums", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 500 }),
        fc.integer({ min: 5, max: 200 }),
        (cols, rows) => {
          const result = applyResize(cols, rows);
          expect(result.cols).toBe(cols);
          expect(result.rows).toBe(rows);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("resize handles special numeric values without throwing", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.constant(Number.NEGATIVE_INFINITY),
          fc.integer({ min: -9999, max: 9999 })
        ),
        fc.oneof(
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.constant(Number.NEGATIVE_INFINITY),
          fc.integer({ min: -9999, max: 9999 })
        ),
        (cols, rows) => {
          expect(() => applyResize(cols, rows)).not.toThrow();
        }
      ),
      { numRuns: 500 }
    );
  });

  // ── TerminalSignal ────────────────────────────────────────────────────

  it("signal correctly maps the 3 valid TerminalSignal values", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("sigint" as const, "sigterm" as const, "sighup" as const),
        (signal) => {
          const result = resolveSignal(signal);
          if (signal === "sigint") expect(result).toBe("SIGINT");
          else if (signal === "sigterm") expect(result).toBe("SIGTERM");
          else expect(result).toBe("SIGHUP");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("signal treats any unrecognized value as SIGHUP fallback", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !["sigint", "sigterm", "sighup"].includes(s)),
        (signal) => {
          const result = resolveSignal(signal);
          expect(result).toBe("SIGHUP");
        }
      ),
      { numRuns: 1000 }
    );
  });
});
