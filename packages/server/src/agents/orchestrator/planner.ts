import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Expand a short task description into a richer product/feature spec using a
 * fast LiteLLM completion call.
 *
 * Triggered when:
 *   - `task.description` is fewer than PLANNER_MIN_CHARS characters
 *   - LiteLLM is reachable
 *   - `VIBE_CODE_PLANNER_ENABLED` is not "false"
 *
 * The expanded spec is:
 *   1. Written to `.vibe-code/context/SPEC.md` in the worktree
 *   2. Saved to `task.planner_spec` in the DB so the UI can surface it
 *   3. Appended to the agent prompt
 *
 * If the call fails or times out the function returns `null` (non-fatal).
 */

const PLANNER_MIN_CHARS = Number(process.env.VIBE_CODE_PLANNER_MIN_CHARS) || 200;
const PLANNER_MODEL = process.env.VIBE_CODE_PLANNER_MODEL || "anthropic/claude-haiku-3-5";
const PLANNER_TIMEOUT_MS = 30_000;

export interface PlannerResult {
  spec: string;
  specPath: string;
}

export async function runPlannerIfNeeded(
  taskTitle: string,
  taskDescription: string,
  wtPath: string,
  litellmBaseUrl: string,
  masterKey: string
): Promise<PlannerResult | null> {
  if (process.env.VIBE_CODE_PLANNER_ENABLED === "false") return null;
  if (taskDescription.trim().length >= PLANNER_MIN_CHARS) return null;

  try {
    const spec = await callPlanner(taskTitle, taskDescription, litellmBaseUrl, masterKey);
    if (!spec) return null;

    const specPath = join(wtPath, ".vibe-code", "context", "SPEC.md");
    await writeFile(specPath, spec, "utf8");
    return { spec, specPath };
  } catch {
    return null;
  }
}

async function callPlanner(
  title: string,
  description: string,
  baseUrl: string,
  masterKey: string
): Promise<string | null> {
  const systemPrompt = [
    "You are a product specification writer for an autonomous AI coding agent.",
    "Given a short task title and optional description, expand it into a clear, actionable product spec.",
    "",
    "Focus on:",
    "- What should be built (deliverables)",
    "- Acceptance criteria (how to verify success)",
    "- High-level technical approach",
    "- Edge cases to handle",
    "",
    "Keep the spec under 600 words. Be concrete. Do NOT include implementation code.",
    "Output only the spec document (Markdown). No preamble.",
  ].join("\n");

  const userPrompt = description?.trim()
    ? `Task: ${title}\n\nContext: ${description}`
    : `Task: ${title}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${masterKey}`,
    },
    body: JSON.stringify({
      model: PLANNER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(PLANNER_TIMEOUT_MS),
  });

  if (!res.ok) return null;

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content?.trim() ?? null;
}
