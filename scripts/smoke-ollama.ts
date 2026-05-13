// smoke test: verifica tool calling com ollama via @ai-sdk/openai compat
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

const ollama = createOpenAI({ baseURL: "http://localhost:11434/v1", apiKey: "ollama" });

const result = await generateText({
  model: ollama.chat("gemma4:e4b"),
  prompt: "Call the greet tool with name='vibe-code', then call finish with a summary.",
  tools: {
    greet: tool({
      description: "Greet someone by name",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => ({ greeting: `hello ${name}` }),
    }),
    finish: tool({
      description: "Signal done",
      inputSchema: z.object({ summary: z.string() }),
      execute: async ({ summary }) => ({ done: true, summary }),
    }),
  },
  stopWhen: stepCountIs(6),
  maxRetries: 1,
});

const toolsCalled = result.steps.flatMap((s) => s.toolCalls ?? []).map((tc) => tc.toolName);
console.log("steps:", result.steps.length);
console.log("tools called:", toolsCalled);
console.log("finish_reason:", result.finishReason);

if (!toolsCalled.includes("greet")) {
  console.error("FAIL: greet tool was not called");
  process.exit(1);
}
console.log("OK: ollama tool calling works");
