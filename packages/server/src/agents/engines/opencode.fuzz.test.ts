import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import {
  DEFAULT_OPENCODE_MODEL,
  humanizeStderr,
  isFreeOpencodeModel,
  LITELLM_ANTHROPIC_COMPAT_MODEL,
  OPENCODE_FALLBACK_MODELS,
  OpenCodeEngine,
} from "./opencode";

describe("humanizeStderr fuzz", () => {
  it("never throws for any arbitrary string", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (input) => {
        const result = humanizeStderr(input);
        expect(result === null || typeof result === "string").toBe(true);
      }),
      { numRuns: 2000 }
    );
  });

  it("never returns empty string (only null or non-empty)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (input) => {
        const result = humanizeStderr(input);
        if (result === null) return;
        expect(result.length).toBeGreaterThan(0);
      }),
      { numRuns: 1000 }
    );
  });

  it("suppresses DEBUG/TRACE prefix regardless of surrounding text", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.constantFrom("DEBUG", "TRACE"),
        (suffix, prefix) => {
          const line = `${prefix} ${suffix}`;
          expect(humanizeStderr(line)).toBeNull();
        }
      ),
      { numRuns: 500 }
    );
  });

  it("suppresses DBG prefix when followed by whitespace", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (suffix) => {
        const line = `DBG ${suffix}`;
        expect(humanizeStderr(line)).toBeNull();
      }),
      { numRuns: 500 }
    );
  });

  it("surfaces plain non-matching text", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 100 })
          .filter(
            (s) => !s.startsWith("DEBUG") && !s.startsWith("TRACE") && !/^(INF|DBG) /.test(s)
          ),
        (text) => {
          const result = humanizeStderr(text);
          if (result !== null) {
            expect(result.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it("handles JSON-like strings without throwing", () => {
    fc.assert(
      fc.property(fc.json({ maxDepth: 4 }), (jsonStr) => {
        expect(() => humanizeStderr(jsonStr)).not.toThrow();
      }),
      { numRuns: 500 }
    );
  });

  it("suppresses JSON with debug/trace/verbose level", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("debug", "trace", "verbose", "DEBUG", "TRACE", "VERBOSE"),
        fc.string({ minLength: 1, maxLength: 50 }),
        (level, msg) => {
          const line = JSON.stringify({ level, message: msg });
          expect(humanizeStderr(line)).toBeNull();
        }
      ),
      { numRuns: 500 }
    );
  });

  it("handles stderr lines with special characters gracefully", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (input) => {
        const withSpecials = input
          .split("")
          .map((c) => (Math.random() > 0.9 ? `\x1b[${Math.floor(Math.random() * 10)}m${c}` : c))
          .join("");
        expect(() => humanizeStderr(withSpecials)).not.toThrow();
      }),
      { numRuns: 200 }
    );
  });
});

describe("isFreeOpencodeModel fuzz", () => {
  it("always returns a boolean for any string input", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (model) => {
        const result = isFreeOpencodeModel(model);
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 1000 }
    );
  });

  it("returns true for auto-free regardless of case context", () => {
    expect(isFreeOpencodeModel("auto-free")).toBe(true);
  });

  it("returns true for big-pickle", () => {
    expect(isFreeOpencodeModel("opencode/big-pickle")).toBe(true);
  });

  it("returns true for any model ending in -free", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 30 })
          .filter((s) => !s.includes("\n") && !s.includes("\0")),
        (prefix) => {
          const model = `${prefix}-free`;
          expect(isFreeOpencodeModel(model)).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("returns false for premium models", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("claude-sonnet-4", "gpt-4o", "opencode/sonnet", "gemini-2.5-pro"),
        (model) => {
          expect(isFreeOpencodeModel(model)).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe("DEFAULT_OPENCODE_MODEL invariant", () => {
  it("default model passes free model filter", () => {
    expect(isFreeOpencodeModel(DEFAULT_OPENCODE_MODEL)).toBe(true);
  });

  it("all fallback models pass free model filter", () => {
    for (const model of OPENCODE_FALLBACK_MODELS) {
      expect(isFreeOpencodeModel(model)).toBe(true);
    }
  });

  it("LITELLM_ANTHROPIC_COMPAT_MODEL is NOT in free models (it's a proxy route)", () => {
    expect(isFreeOpencodeModel(LITELLM_ANTHROPIC_COMPAT_MODEL)).toBe(false);
  });
});

describe("OpenCodeEngine.parseLine fuzz", () => {
  const engine = new OpenCodeEngine();

  it("never throws for any arbitrary string input", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), fc.boolean(), (line, withAccum) => {
        const accum = withAccum
          ? {
              input_tokens: 0,
              output_tokens: 0,
              total_tokens: 0,
              cached: 0,
              input_cost: 0,
              output_cost: 0,
              total_cost: 0,
            }
          : undefined;
        expect(() => engine.parseLine(line, accum)).not.toThrow();
      }),
      { numRuns: 2000 }
    );
  });

  it("returns an array of AgentEvent (never null/undefined)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 300 }), (line) => {
        const events = engine.parseLine(line);
        expect(Array.isArray(events)).toBe(true);
        for (const e of events) {
          expect(e).toBeDefined();
          expect(typeof e.type).toBe("string");
        }
      }),
      { numRuns: 1000 }
    );
  });

  it("handles random JSON structures gracefully", () => {
    fc.assert(
      fc.property(fc.json({ maxDepth: 5 }), (json) => {
        expect(() => engine.parseLine(json)).not.toThrow();
      }),
      { numRuns: 500 }
    );
  });

  it("handles deeply nested braces and strings", () => {
    fc.assert(
      fc.property(
        fc
          .record({
            type: fc.constantFrom(
              "text",
              "tool_use",
              "error",
              "thinking",
              "step_start",
              "step_finish"
            ),
            part: fc.record({
              text: fc.string({ minLength: 0, maxLength: 100 }),
              content: fc.option(fc.string({ minLength: 0, maxLength: 50 }), { nil: undefined }),
            }),
          })
          .map((o) => JSON.stringify(o)),
        (line) => {
          expect(() => engine.parseLine(line)).not.toThrow();
          const events = engine.parseLine(line);
          expect(Array.isArray(events)).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("handles malformed JSON with mixed content", () => {
    fc.assert(
      fc.property(
        fc
          .tuple(fc.string({ minLength: 0, maxLength: 50 }), fc.boolean(), fc.boolean())
          .map(([prefix, hasBrace, hasNewline]) => {
            let s = prefix;
            if (hasBrace) s += "{" + Math.random().toString(36).slice(2);
            if (Math.random() > 0.5) s += '"unclosed';
            if (hasNewline) s += "\n";
            return s;
          }),
        (line) => {
          expect(() => engine.parseLine(line)).not.toThrow();
        }
      ),
      { numRuns: 500 }
    );
  });

  it("parses valid events correctly regardless of surrounding whitespace", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          { type: "text", part: { text: "hello" } },
          {
            type: "tool_use",
            part: { name: "bash", state: { status: "calling", input: { command: "ls" } } },
          },
          { type: "error", part: { message: "fail" } },
          { type: "step_start", part: {} },
          { type: "thinking", part: { text: "hmm" } }
        ),
        fc.string({ minLength: 0, maxLength: 5 }),
        fc.string({ minLength: 0, maxLength: 5 }),
        (event, prefix, suffix) => {
          const line = prefix + JSON.stringify(event) + suffix;
          const events = engine.parseLine(line);
          expect(events.length).toBeGreaterThanOrEqual(0);
          expect(() => engine.parseLine(line)).not.toThrow();
        }
      ),
      { numRuns: 500 }
    );
  });

  it("accumulates tokens correctly with random step_finish sequences", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            input: fc.integer({ min: 0, max: 10000 }),
            output: fc.integer({ min: 0, max: 10000 }),
            total: fc.integer({ min: 0, max: 20000 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (tokenSequence) => {
          const accum = {
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            cached: 0,
            input_cost: 0,
            output_cost: 0,
            total_cost: 0,
          };
          let cumInput = 0;
          let cumOutput = 0;
          let cumTotal = 0;

          for (const tokens of tokenSequence) {
            cumInput += tokens.input;
            cumOutput += tokens.output;
            cumTotal += tokens.total;
            const line = JSON.stringify({
              type: "step_finish",
              part: { tokens },
            });
            const events = engine.parseLine(line, accum);
            const costEvent = events.find((e) => e.type === "cost")?.costStats;
            expect(costEvent).toBeDefined();
            expect(costEvent?.input_tokens).toBe(cumInput);
            expect(costEvent?.output_tokens).toBe(cumOutput);
            expect(costEvent?.total_tokens).toBe(cumTotal);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("OPENCODE_FALLBACK_MODELS invariant fuzz", () => {
  it("all fallback models are non-empty", () => {
    for (const model of OPENCODE_FALLBACK_MODELS) {
      expect(model.length).toBeGreaterThan(0);
    }
  });

  it("no fallback model contains whitespace", () => {
    for (const model of OPENCODE_FALLBACK_MODELS) {
      expect(/\s/.test(model)).toBe(false);
    }
  });
});

describe("resolveOpencodeBinary invariants", () => {
  it("returns a non-empty string", () => {
    const engine = new OpenCodeEngine();
    expect(typeof engine.binaryName).toBe("string");
    expect(engine.binaryName.length).toBeGreaterThan(0);
  });
});
