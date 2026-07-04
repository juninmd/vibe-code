import { describe, expect, it } from "bun:test";
import type { RuleEntry, SkillEffectiveness } from "@vibe-code/shared";
import fc from "fast-check";

// ── Replicated internal functions from matcher.ts ────────────────────────────

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9_+#.-]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2)
    )
  );
}

function keywordOverlap(text: string, tokens: string[]): number {
  const lower = text.toLowerCase();
  return tokens.filter((token) => lower.includes(token)).length;
}

function matchRules(rules: RuleEntry[], fileExtensions: Set<string>): RuleEntry[] {
  if (fileExtensions.size === 0) return rules.slice(0, 5);
  return rules.filter((rule) => {
    if (!rule.applyTo) return true;
    const extMatch = rule.applyTo.match(/\.\{([^}]+)\}/);
    if (extMatch) {
      const exts = extMatch[1].split(",").map((e) => e.trim());
      return exts.some((ext) => fileExtensions.has(ext));
    }
    const simpleMatch = rule.applyTo.match(/\*\.(\w+)$/);
    if (simpleMatch) {
      return fileExtensions.has(simpleMatch[1]);
    }
    return true;
  });
}

function metricBonus(
  name: string,
  metrics?: SkillEffectiveness[]
): { score: number; reason?: string } {
  const metric = metrics?.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (!metric) return { score: 0 };
  const score = metric.successRate / 20 - metric.avgBlockers * 2 - metric.avgWarnings;
  if (score <= 0) return { score: 0 };
  return { score, reason: `historical-success:${metric.successRate}` };
}

function resolveDependencies<T extends { name: string; dependencies?: string[] }>(
  allEntries: T[],
  initialSelection: T[]
): T[] {
  const result = new Map<string, T>();
  const queue = [...initialSelection];
  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) continue;
    if (result.has(entry.name)) continue;
    result.set(entry.name, entry);
    if (entry.dependencies) {
      for (const depName of entry.dependencies) {
        const dep = allEntries.find((e) => e.name === depName);
        if (dep && !result.has(dep.name)) {
          queue.push(dep);
        }
      }
    }
  }
  return Array.from(result.values());
}

function extractGlobExtensions(applyTo: string): string[] | null {
  const extMatch = applyTo.match(/\.\{([^}]+)\}/);
  if (extMatch) {
    return extMatch[1].split(",").map((e) => e.trim());
  }
  const simpleMatch = applyTo.match(/\*\.(\w+)$/);
  if (simpleMatch) {
    return [simpleMatch[1]];
  }
  return null;
}

const MAX_INJECTION_CHARS = 8000;

function trimToBudget<T extends { name: string; description: string }>(entries: T[]): T[] {
  let totalChars = 0;
  const result: T[] = [];
  for (const entry of entries) {
    const size = entry.name.length + entry.description.length + 50;
    if (totalChars + size > MAX_INJECTION_CHARS) break;
    totalChars += size;
    result.push(entry);
  }
  return result;
}

// ── Tokenize fuzz tests ──────────────────────────────────────────────────────

describe("tokenize fuzz", () => {
  it("never throws for any string", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (input) => {
        expect(() => tokenize(input)).not.toThrow();
      }),
      { numRuns: 2000 }
    );
  });

  it("always returns string[]", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 300 }), (input) => {
        const result = tokenize(input);
        expect(Array.isArray(result)).toBe(true);
        for (const item of result) {
          expect(typeof item).toBe("string");
        }
      }),
      { numRuns: 1000 }
    );
  });

  it("never contains tokens shorter than 3 chars", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 300 }), (input) => {
        const result = tokenize(input);
        for (const token of result) {
          expect(token.length).toBeGreaterThan(2);
        }
      }),
      { numRuns: 1000 }
    );
  });

  it("never contains tokens with chars outside a-z0-9_+#.-", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 300 }), (input) => {
        const result = tokenize(input);
        for (const token of result) {
          expect(token).toMatch(/^[a-z0-9_+#.-]+$/);
        }
      }),
      { numRuns: 1000 }
    );
  });

  it("never returns null or undefined elements", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 300 }), (input) => {
        const result = tokenize(input);
        for (const item of result) {
          expect(item).not.toBeNull();
          expect(item).not.toBeUndefined();
        }
      }),
      { numRuns: 1000 }
    );
  });

  it("returns empty array for input with no words > 2 chars", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom("", "a", "ab", "a b", "x y z", "!!", "@@", "  "),
          fc
            .array(
              fc.constantFrom(
                "!",
                "@",
                "$",
                "%",
                "^",
                "&",
                "*",
                "(",
                ")",
                "{",
                "}",
                "[",
                "]",
                " ",
                "\t",
                "\n",
                "\r"
              ),
              { minLength: 0, maxLength: 30 }
            )
            .map((chars) => chars.join(""))
        ),
        (input) => {
          const result = tokenize(input);
          expect(result).toEqual([]);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("deduplicates identical tokens", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.nat({ max: 5 }),
        (base, repeat) => {
          const input = Array.from({ length: repeat + 1 })
            .fill(base)
            .join(" ");
          const result = tokenize(input);
          const uniqueFromBase = tokenize(base);
          expect(result.length).toBe(uniqueFromBase.length);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("is idempotent (applying twice yields same result)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (input) => {
        const first = tokenize(input);
        const second = tokenize(first.join(" "));
        expect(first).toEqual(second);
      }),
      { numRuns: 500 }
    );
  });
});

// ── keywordOverlap fuzz tests ────────────────────────────────────────────────

describe("keywordOverlap fuzz", () => {
  it("never throws for any valid input", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 20 }),
        (text, tokens) => {
          expect(() => keywordOverlap(text, tokens)).not.toThrow();
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("returns non-negative integer", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 20 }),
        (text, tokens) => {
          const result = keywordOverlap(text, tokens);
          expect(Number.isInteger(result)).toBe(true);
          expect(result).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("returns 0 for empty tokens array", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (text) => {
        expect(keywordOverlap(text, [])).toBe(0);
      }),
      { numRuns: 200 }
    );
  });

  it("returns tokens.length when all tokens are in text", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[a-z0-9_+#.-]+$/.test(s)),
          { maxLength: 10 }
        ),
        (tokens) => {
          const text = tokens.join(" ");
          const count = keywordOverlap(text, tokens);
          expect(count).toBe(tokens.length);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("is monotonically increasing when text is extended with matching content", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 10 }),
        (prefix, tokens) => {
          const before = keywordOverlap(prefix, tokens);
          const extended = prefix + " " + tokens.join(" ");
          const after = keywordOverlap(extended, tokens);
          expect(after).toBeGreaterThanOrEqual(before);
        }
      ),
      { numRuns: 500 }
    );
  });
});

// ── matchRules fuzz tests ────────────────────────────────────────────────────

describe("matchRules fuzz", () => {
  it("never throws for any input", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            description: fc.string({ minLength: 1, maxLength: 50 }),
            applyTo: fc.string({ minLength: 0, maxLength: 50 }),
            category: fc.constant<"rule">("rule"),
            filePath: fc.string({ minLength: 1, maxLength: 30 }),
          }),
          { maxLength: 10 }
        ),
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 10 }),
        (rules, extList) => {
          const exts = new Set(extList);
          expect(() => matchRules(rules, exts)).not.toThrow();
        }
      ),
      { numRuns: 500 }
    );
  });

  it("falls back to first 5 rules when fileExtensions is empty", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            description: fc.string({ minLength: 1, maxLength: 20 }),
            applyTo: fc.string({ minLength: 0, maxLength: 20 }),
            category: fc.constant<"rule">("rule"),
            filePath: fc.string({ minLength: 1, maxLength: 20 }),
          }),
          { minLength: 0, maxLength: 20 }
        ),
        (rules) => {
          const result = matchRules(rules, new Set<string>());
          expect(result.length).toBe(Math.min(rules.length, 5));
        }
      ),
      { numRuns: 200 }
    );
  });

  it("returns all rules when all have missing applyTo pattern (non-empty extensions)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            description: fc.string({ minLength: 1, maxLength: 20 }),
            applyTo: fc.constant("some-broken-pattern"),
            category: fc.constant<"rule">("rule"),
            filePath: fc.string({ minLength: 1, maxLength: 20 }),
          }),
          { minLength: 0, maxLength: 10 }
        ),
        fc.array(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 5 }),
        (rules, extList) => {
          const result = matchRules(rules, new Set(extList));
          expect(result.length).toBe(rules.length);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ── Glob extraction fuzz tests ───────────────────────────────────────────────

describe("glob extraction fuzz", () => {
  it("extracts extensions from {ts,tsx,js} pattern", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^\w+$/.test(s)),
          {
            minLength: 1,
            maxLength: 5,
          }
        ),
        (exts) => {
          const pattern = `**/*.{${exts.join(",")}}`;
          const extracted = extractGlobExtensions(pattern);
          expect(extracted).toEqual(exts);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("extracts single extension from *.ext pattern", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 10 })
          .filter((s) => /^\w+$/.test(s) && !s.includes("{")),
        (ext) => {
          const pattern = `**/*.${ext}`;
          const extracted = extractGlobExtensions(pattern);
          expect(extracted).toEqual([ext]);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("returns null for patterns with no glob match", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 0, maxLength: 30 })
          .filter((s) => !/\.\{[^}]+\}/.test(s) && !/\*\.\w+$/.test(s)),
        (pattern) => {
          expect(extractGlobExtensions(pattern)).toBeNull();
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ── metricBonus fuzz tests ───────────────────────────────────────────────────

describe("metricBonus fuzz", () => {
  it("never throws for any input", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.option(
          fc.array(
            fc.record({
              name: fc.string({ minLength: 1, maxLength: 30 }),
              totalRuns: fc.nat({ max: 1000 }),
              successRate: fc.nat({ max: 100 }),
              avgBlockers: fc.nat({ max: 20 }),
              avgWarnings: fc.nat({ max: 20 }),
            }),
            { maxLength: 10 }
          ),
          { nil: undefined }
        ),
        (name, metrics) => {
          expect(() => metricBonus(name, metrics)).not.toThrow();
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("returns object with score number and optional reason string", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.option(
          fc.array(
            fc.record({
              name: fc.string({ minLength: 1, maxLength: 30 }),
              totalRuns: fc.nat({ max: 1000 }),
              successRate: fc.nat({ max: 100 }),
              avgBlockers: fc.nat({ max: 20 }),
              avgWarnings: fc.nat({ max: 20 }),
            }),
            { maxLength: 10 }
          ),
          { nil: undefined }
        ),
        (name, metrics) => {
          const result = metricBonus(name, metrics);
          expect(typeof result.score).toBe("number");
          expect(result.reason === undefined || typeof result.reason === "string").toBe(true);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("score is never negative", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.option(
          fc.array(
            fc.record({
              name: fc.string({ minLength: 1, maxLength: 30 }),
              totalRuns: fc.nat({ max: 1000 }),
              successRate: fc.nat({ max: 100 }),
              avgBlockers: fc.nat({ max: 20 }),
              avgWarnings: fc.nat({ max: 20 }),
            }),
            { maxLength: 10 }
          ),
          { nil: undefined }
        ),
        (name, metrics) => {
          const result = metricBonus(name, metrics);
          expect(result.score).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("returns score 0 and no reason when metrics are undefined", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (name) => {
        const result = metricBonus(name, undefined);
        expect(result.score).toBe(0);
        expect(result.reason).toBeUndefined();
      }),
      { numRuns: 200 }
    );
  });

  it("returns score 0 and no reason when metrics array is empty", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (name) => {
        const result = metricBonus(name, []);
        expect(result.score).toBe(0);
        expect(result.reason).toBeUndefined();
      }),
      { numRuns: 200 }
    );
  });

  it("returns score > 0 with reason only when quality is high enough", () => {
    fc.assert(
      fc.property(
        fc
          .record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            totalRuns: fc.nat({ max: 1000 }),
            successRate: fc.integer({ min: 1, max: 100 }),
            avgBlockers: fc.nat({ max: 20 }),
            avgWarnings: fc.nat({ max: 20 }),
          })
          .filter((m) => m.successRate / 20 - m.avgBlockers * 2 - m.avgWarnings > 0),
        (metric) => {
          const result = metricBonus(metric.name, [metric]);
          expect(result.score).toBeGreaterThan(0);
          expect(result.reason).toContain("historical-success");
        }
      ),
      { numRuns: 500 }
    );
  });

  it("score is deterministic for the same inputs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc
          .record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            totalRuns: fc.nat({ max: 1000 }),
            successRate: fc.nat({ max: 100 }),
            avgBlockers: fc.nat({ max: 20 }),
            avgWarnings: fc.nat({ max: 20 }),
          })
          .filter((m) => m.successRate / 20 - m.avgBlockers * 2 - m.avgWarnings > 0),
        (name, metric) => {
          const a = metricBonus(name, [metric]);
          const b = metricBonus(name, [metric]);
          expect(a.score).toBe(b.score);
          expect(a.reason).toBe(b.reason);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ── resolveDependencies fuzz tests ───────────────────────────────────────────

describe("resolveDependencies fuzz", () => {
  it("never throws for any input", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            dependencies: fc.option(
              fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
              { nil: undefined }
            ),
          }),
          { maxLength: 10 }
        ),
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            dependencies: fc.option(
              fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
              { nil: undefined }
            ),
          }),
          { maxLength: 5 }
        ),
        (allEntries, initialSelection) => {
          expect(() => resolveDependencies(allEntries, initialSelection)).not.toThrow();
        }
      ),
      { numRuns: 500 }
    );
  });

  it("never returns null", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            dependencies: fc.option(
              fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
              { nil: undefined }
            ),
          }),
          { maxLength: 10 }
        ),
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            dependencies: fc.option(
              fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
              { nil: undefined }
            ),
          }),
          { maxLength: 5 }
        ),
        (allEntries, initialSelection) => {
          const result = resolveDependencies(allEntries, initialSelection);
          expect(result).not.toBeNull();
        }
      ),
      { numRuns: 500 }
    );
  });

  it("result includes all initial selections", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            dependencies: fc.option(
              fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
              { nil: undefined }
            ),
          }),
          { minLength: 0, maxLength: 10 }
        ),
        (entries) => {
          const result = resolveDependencies(entries, entries);
          for (const entry of entries) {
            expect(result.some((r) => r.name === entry.name)).toBe(true);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it("no duplicates in result", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            dependencies: fc.option(
              fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
              { nil: undefined }
            ),
          }),
          { minLength: 0, maxLength: 10 }
        ),
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            dependencies: fc.option(
              fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
              { nil: undefined }
            ),
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (allEntries, initialSelection) => {
          const result = resolveDependencies(allEntries, initialSelection);
          const names = result.map((e) => e.name);
          expect(new Set(names).size).toBe(names.length);
        }
      ),
      { numRuns: 300 }
    );
  });

  it("order is deterministic for the same inputs", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            dependencies: fc.option(
              fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
              { nil: undefined }
            ),
          }),
          { minLength: 0, maxLength: 10 }
        ),
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            dependencies: fc.option(
              fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
              { nil: undefined }
            ),
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (allEntries, initialSelection) => {
          const a = resolveDependencies(allEntries, initialSelection);
          const b = resolveDependencies(allEntries, initialSelection);
          expect(a.map((e) => e.name)).toEqual(b.map((e) => e.name));
        }
      ),
      { numRuns: 300 }
    );
  });

  it("discards dangling dependency references without error", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 10 }),
            dependencies: fc.option(
              fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 3 }),
              { nil: undefined }
            ),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (entries) => {
          const result = resolveDependencies(entries, entries);
          expect(result.length).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ── trimToBudget fuzz tests ──────────────────────────────────────────────────

describe("trimToBudget fuzz", () => {
  it("total chars never exceeds 8000 after trimming", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 0, maxLength: 50 }),
            description: fc.string({ minLength: 0, maxLength: 200 }),
          }),
          { minLength: 0, maxLength: 100 }
        ),
        (entries) => {
          const trimmed = trimToBudget(entries);
          const totalChars = trimmed.reduce(
            (sum, e) => sum + e.name.length + e.description.length + 50,
            0
          );
          expect(totalChars).toBeLessThanOrEqual(8000);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("trimming preserves order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 0, maxLength: 30 }),
            description: fc.string({ minLength: 0, maxLength: 100 }),
          }),
          { minLength: 0, maxLength: 50 }
        ),
        (entries) => {
          const trimmed = trimToBudget(entries);
          for (let i = 0; i < trimmed.length; i++) {
            expect(trimmed[i]).toBe(entries[i]);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it("returns all entries when total fits within budget", () => {
    fc.assert(
      fc.property(
        fc
          .array(
            fc.record({
              name: fc.constant("x"),
              description: fc.constant("y"),
            }),
            { minLength: 0, maxLength: 100 }
          )
          .filter((arr) => arr.length * (1 + 1 + 50) <= 8000),
        (entries) => {
          const trimmed = trimToBudget(entries);
          expect(trimmed.length).toBe(entries.length);
        }
      ),
      { numRuns: 200 }
    );
  });
});
