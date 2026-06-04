import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function findStringArrays(content: string): string[][] {
  const arrays: string[][] = [];
  // Match array literals like ["a", "b", "c"]
  const regex = /\[\s*(?:(?:'[^']*'|"[^"]*")\s*,\s*)*(?:'[^']*'|"[^"]*")\s*\]/g;
  const matches = content.match(regex);
  if (matches) {
    for (const m of matches) {
      try {
        const jsonStr = m.replace(/'/g, '"');
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
          arrays.push(parsed);
        }
      } catch {
        // ignore malformed/dynamic arrays
      }
    }
  }
  return arrays;
}

describe("Agent Engines hardcoded models verification", () => {
  const dir = __dirname;
  const files = readdirSync(dir).filter(
    (f) =>
      f.endsWith(".ts") &&
      !f.endsWith(".test.ts") &&
      f !== "index.ts" &&
      f !== "acp-parser.ts" &&
      f !== "heartbeat.ts" &&
      f !== "stderr-tail.ts" &&
      f !== "blocked-args.ts"
  );

  const modelKeywords = [
    "gpt-4",
    "gpt-5",
    "claude-3",
    "gemini-1.5",
    "gemini-2",
    "gemini-3",
    "grok-build",
    "grok-composer",
    "deepseek-",
    "minimax-",
    "nemotron-",
    "mimo-",
    "qwen",
    "mistral-",
    "llama-",
  ];

  for (const file of files) {
    test(`Engine ${file} does not contain static/hardcoded model lists`, () => {
      const content = readFileSync(join(dir, file), "utf-8");
      const arrays = findStringArrays(content);
      const hardcodedModelArrays: string[][] = [];

      for (const arr of arrays) {
        // Skip command arrays
        if (
          arr.some(
            (x) =>
              x.startsWith("-") ||
              x === "models" ||
              x === "run" ||
              x === "acp" ||
              x === "version" ||
              x === "doctor"
          )
        ) {
          continue;
        }

        // Check if any element looks like a model ID or provider path
        const hasModel = arr.some(
          (x) =>
            modelKeywords.some((kw) => x.toLowerCase().includes(kw)) ||
            (x.includes("/") && x.split("/")[0].length > 2 && x.split("/")[1].length > 2)
        );

        if (hasModel) {
          hardcodedModelArrays.push(arr);
        }
      }

      if (hardcodedModelArrays.length > 0) {
        console.error(`Found hardcoded model list in ${file}:`, hardcodedModelArrays);
      }

      expect(hardcodedModelArrays.length).toBe(0);
    });
  }
});
