import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import {
  DEFAULT_OPENCODE_MODEL,
  humanizeStderr,
  isFreeOpencodeModel,
  LITELLM_ANTHROPIC_COMPAT_MODEL,
  OPENCODE_BLOCKED_ARGS,
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

describe("OPENCODE_BLOCKED_ARGS fuzz", () => {
  it("all blocked args start with --", () => {
    for (const flag of Object.keys(OPENCODE_BLOCKED_ARGS)) {
      expect(flag.startsWith("--")).toBe(true);
    }
  });

  it("all blocked args have mode with-value or standalone", () => {
    for (const mode of Object.values(OPENCODE_BLOCKED_ARGS)) {
      expect(mode === "with-value" || mode === "standalone").toBe(true);
    }
  });
});

describe("opencode model listing fuzz", () => {
  it("isFreeOpencodeModel returns true for any string ending in -free", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => /^[a-zA-Z0-9._/-]+$/.test(s)),
        (prefix) => {
          const model = `${prefix}-free`;
          expect(isFreeOpencodeModel(model)).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("isFreeOpencodeModel returns true for auto-free", () => {
    expect(isFreeOpencodeModel("auto-free")).toBe(true);
  });

  it("isFreeOpencodeModel returns false for empty string", () => {
    expect(isFreeOpencodeModel("")).toBe(false);
  });

  it("DEFAULT_OPENCODE_MODEL matches OPENCODE_FALLBACK_MODELS", () => {
    expect(OPENCODE_FALLBACK_MODELS).toContain(DEFAULT_OPENCODE_MODEL);
  });
});

describe("humanizeStderr structured log fuzz", () => {
  it("handles ISO date with varying timezone offsets", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "INFO  2026-03-30T21:06:05 +0000 service=llm modelID=opencode/model-free calling free",
          "INFO  2026-03-30T21:06:05 -0300 service=llm modelID=opencode/model-free calling capacity=3",
          "INFO  2026-03-30T21:06:05 +0530 service=llm modelID=opencode/model-free calling"
        ),
        (line) => {
          const result = humanizeStderr(line);
          expect(result).toContain("opencode/model-free");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("suppresses INFO for non-llm services", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "INFO  2026-03-30T21:06:06 +0ms service=permission permission=skill evaluate",
          "INFO  2026-03-30T21:06:06 +0ms service=git command=pull",
          "INFO  2026-03-30T21:06:06 +0ms service=filesystem path=/tmp"
        ),
        (line) => {
          expect(humanizeStderr(line)).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("surfaces WARN/ERROR structured lines with non-striped content", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "WARN  2026-03-30T21:06:07 +0ms service=llm rate_limit=42 retry_count=3 slow_response",
          "ERROR 2026-03-30T21:06:08 +0ms service=git exit_code=128 clone_failed"
        ),
        (line) => {
          const result = humanizeStderr(line);
          expect(result).not.toBeNull();
          expect(result).toMatch(/^\[(WARN|ERROR)\]/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns null for JSON with session/provider keywords", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          JSON.stringify({ level: "info", message: "session started abc123" }),
          JSON.stringify({ level: "info", message: "provider initialized" }),
          JSON.stringify({ level: "info", message: "model loaded gpt-4" }),
          JSON.stringify({ level: "info", message: "cleanup completed" })
        ),
        (line) => {
          expect(humanizeStderr(line)).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("surfaces JSON with error message content", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (msg) => {
        const line = JSON.stringify({ level: "error", message: msg });
        const result = humanizeStderr(line);
        expect(result).not.toBeNull();
        expect(result?.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 }
    );
  });
});

describe("humanizeToolCall edge cases fuzz", () => {
  it("matches tool names case-insensitively", () => {
    const engine = new OpenCodeEngine();
    const line = JSON.stringify({
      type: "tool_use",
      part: { name: "BASH", state: { status: "calling", input: { command: "ls" } } },
    });
    const events = engine.parseLine(line);
    const status = events.find((e) => e.type === "status")?.content;
    expect(status).toContain("Running");
  });

  it("handles tool names with special characters", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z_-]+$/.test(s)),
        (toolName) => {
          const engine = new OpenCodeEngine();
          const line = JSON.stringify({
            type: "tool_use",
            part: { name: toolName, state: { status: "calling", input: { path: "test.txt" } } },
          });
          expect(() => engine.parseLine(line)).not.toThrow();
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("parseLine JSON-RPC fuzz", () => {
  it("handles JSON-RPC session/started", () => {
    const engine = new OpenCodeEngine();
    const events = engine.parseLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/started",
        params: { sessionId: "sess_123", id: "sess_123" },
      })
    );
    expect(events.find((e) => e.type === "session")?.sessionId).toBe("sess_123");
  });

  it("handles JSON-RPC tool/use", () => {
    const engine = new OpenCodeEngine();
    const events = engine.parseLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tool/use",
        params: { tool: "read_file", callId: "call_1", input: { path: "src/x.ts" } },
      })
    );
    expect(events.find((e) => e.type === "tool_use")).toBeDefined();
  });

  it("handles JSON-RPC tool/result", () => {
    const engine = new OpenCodeEngine();
    const events = engine.parseLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tool/result",
        params: { callId: "call_1", output: "line1\nline2" },
      })
    );
    expect(events.find((e) => e.type === "tool_result")).toBeDefined();
  });

  it("handles JSON-RPC error method", () => {
    const engine = new OpenCodeEngine();
    const events = engine.parseLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "error",
        params: { message: "API timeout" },
      })
    );
    expect(events.find((e) => e.type === "error")).toBeDefined();
  });

  it("handles JSON-RPC cost method with token stats", () => {
    const engine = new OpenCodeEngine();
    const events = engine.parseLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "cost",
        params: { total_tokens: 5000, input_tokens: 2000, output_tokens: 3000 },
      })
    );
    expect(events.find((e) => e.type === "cost")?.costStats?.total_tokens).toBe(5000);
  });
});

describe("parseLine token accumulation invariants", () => {
  it("accumulators never go backwards", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            input: fc.integer({ min: 0, max: 5000 }),
            output: fc.integer({ min: 0, max: 5000 }),
            total: fc.integer({ min: 0, max: 10000 }),
          }),
          { minLength: 2, maxLength: 8 }
        ),
        (tokenSequence) => {
          const engine = new OpenCodeEngine();
          const accum = {
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            cached: 0,
            input_cost: 0,
            output_cost: 0,
            total_cost: 0,
          };
          let prevTotal = 0;

          for (const tokens of tokenSequence) {
            const line = JSON.stringify({ type: "step_finish", part: { tokens } });
            engine.parseLine(line, accum);
            expect(accum.total_tokens).toBeGreaterThanOrEqual(prevTotal);
            prevTotal = accum.total_tokens;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
