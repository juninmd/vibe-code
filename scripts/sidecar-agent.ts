import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, stepCountIs } from "ai";
import type { SidecarConfig } from "./sidecar";
import type { SidecarDb } from "./sidecar-db";
import { buildTools } from "./sidecar-tools";

const SYSTEM_PROMPT = `You are an autonomous code improvement agent for software repositories.

You have tools to:
1. List repositories registered in vibe-code
2. Check run history and accumulated learnings per repo
3. Create and launch improvement tasks using the opencode engine
4. Monitor task execution via WebSocket
5. Collect task logs and save learnings for future cycles

Your cycle for each enabled repository:
- Check recent run history and existing learnings
- Identify what has NOT been tried or what failed before
- Create ONE specific, actionable task (avoid generic "improve everything" prompts)
- Launch and monitor it to completion
- Read logs to understand the outcome
- Save a concise learning note: what was attempted, what succeeded or failed, what to try next

When all repositories have been processed, call the \`finish\` tool with a brief summary.
Be efficient — do not repeat tasks that already completed successfully in recent runs.`;

function buildUserPrompt(repoUrls: string[]): string {
  return `Start the improvement cycle for these repositories:\n${repoUrls.map((u) => `- ${u}`).join("\n")}`;
}

function resolveModel(config: SidecarConfig) {
  if (config.provider === "ollama") {
    const baseURL = `${config.ollamaBaseUrl ?? "http://localhost:11434"}/v1`;
    const ollama = createOpenAI({ baseURL, apiKey: "ollama" });
    return ollama.chat(config.model ?? "gemma4:e4b");
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY env var is required for openrouter provider");
  const openrouter = createOpenRouter({ apiKey });
  return openrouter.chat(config.model ?? "google/gemini-2.0-flash-lite-001");
}

export async function runAgentCycle(
  config: SidecarConfig,
  db: SidecarDb,
  repoUrls: string[]
): Promise<void> {
  if (repoUrls.length === 0) {
    console.log("[sidecar] No enabled repos to process");
    return;
  }

  const model = resolveModel(config);
  const tools = buildTools({ config, db });

  console.log(`[sidecar] Starting agent cycle for ${repoUrls.length} repo(s)`);

  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(repoUrls),
    tools,
    stopWhen: stepCountIs(30),
    maxRetries: 2,
  });

  const finishStep = result.steps.findLast((s) =>
    s.toolCalls?.some((tc) => tc.toolName === "finish")
  );

  if (finishStep) {
    const finishCall = finishStep.toolCalls?.find((tc) => tc.toolName === "finish");
    const summary = (finishCall?.args as { summary?: string })?.summary ?? "cycle complete";
    console.log(`[sidecar] Cycle finished: ${summary}`);
  } else {
    console.log(`[sidecar] Cycle ended after ${result.steps.length} steps (no finish call)`);
  }
}
