/**
 * PostRunEvaluator — grades agent output before it proceeds to PR creation.
 *
 * Runs after the main agent completes (and after the final validator) to catch
 * feature-completeness gaps. Uses a fast LLM call that compares the git diff
 * against the original task spec, producing a structured grade.
 *
 * Grade schema: { score: 0-10, pass: boolean, feedback: string }
 *
 * Controlled by:
 *   VIBE_CODE_EVALUATOR_ENABLED=true   (default: false — opt-in)
 *   VIBE_CODE_EVALUATOR_THRESHOLD=7    (default: 7, out of 10)
 *   VIBE_CODE_EVALUATOR_MODEL=...      (default: anthropic/claude-haiku-3-5)
 */

const EVALUATOR_ENABLED = process.env.VIBE_CODE_EVALUATOR_ENABLED === "true";
const EVALUATOR_THRESHOLD = Number(process.env.VIBE_CODE_EVALUATOR_THRESHOLD) || 7;
const EVALUATOR_MODEL = process.env.VIBE_CODE_EVALUATOR_MODEL || "anthropic/claude-haiku-3-5";
const EVALUATOR_TIMEOUT_MS = 45_000;
const MAX_DIFF_CHARS = 8_000;

export interface EvaluatorResult {
  score: number;
  pass: boolean;
  feedback: string;
}

/**
 * Grade the diff of `wtPath` against `baseBranch` relative to the task spec.
 *
 * Returns null when the evaluator is disabled, the model call fails, or the
 * diff is empty (nothing to grade).
 */
export async function runPostRunEvaluator(
  taskTitle: string,
  taskDescription: string,
  wtPath: string,
  baseBranch: string,
  litellmBaseUrl: string,
  litellmKey: string
): Promise<EvaluatorResult | null> {
  const isEnabled = process.env.VIBE_CODE_EVALUATOR_ENABLED === "true";
  if (!isEnabled) return null;

  const diff = await getGitDiff(wtPath, baseBranch);
  if (!diff.trim()) return null;

  try {
    return await callEvaluator(taskTitle, taskDescription, diff, litellmBaseUrl, litellmKey);
  } catch {
    return null;
  }
}

async function getGitDiff(wtPath: string, baseBranch: string): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "diff", `origin/${baseBranch}...HEAD`, "--stat"], {
      cwd: wtPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    const stat = await new Response(proc.stdout).text();

    // Get actual diff but cap at MAX_DIFF_CHARS
    const proc2 = Bun.spawn(["git", "diff", `origin/${baseBranch}...HEAD`], {
      cwd: wtPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc2.exited;
    const fullDiff = await new Response(proc2.stdout).text();
    const truncated = fullDiff.slice(0, MAX_DIFF_CHARS);
    const suffix = fullDiff.length > MAX_DIFF_CHARS ? "\n... (diff truncated)" : "";
    return `${stat}\n${truncated}${suffix}`;
  } catch {
    return "";
  }
}

async function callEvaluator(
  title: string,
  description: string,
  diff: string,
  baseUrl: string,
  apiKey: string
): Promise<EvaluatorResult | null> {
  const threshold = Number(process.env.VIBE_CODE_EVALUATOR_THRESHOLD) || 7;
  const model = process.env.VIBE_CODE_EVALUATOR_MODEL || "anthropic/claude-haiku-3-5";

  const systemPrompt = [
    "You are a strict QA evaluator for an autonomous AI coding agent.",
    "Your job is to evaluate whether the code changes (diff) implement the required task spec.",
    "",
    "Grade criteria (each out of 2 points, total 10):",
    "1. Completeness: All requirements in the spec are implemented",
    "2. Correctness: No obvious logic errors, broken tests, or stubs",
    "3. Scope: Changes are scoped to the task (no unrelated modifications)",
    "4. Test coverage: New behaviour is tested if applicable",
    "5. Code quality: No placeholder comments, TODO stubs, or unfinished blocks",
    "",
    `Passing threshold: ${threshold}/10`,
    "",
    "Respond ONLY with valid JSON in this exact shape:",
    '{ "score": <0-10>, "pass": <true|false>, "feedback": "<one-paragraph critique>" }',
  ].join("\n");

  const userPrompt = [
    `Task: ${title}`,
    description?.trim() ? `\nSpec:\n${description.trim()}` : "",
    `\nGit diff:\n${diff}`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 512,
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(EVALUATOR_TIMEOUT_MS),
  });

  if (!res.ok) return null;

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = json.choices?.[0]?.message?.content?.trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { score?: number; pass?: boolean; feedback?: string };
    const score = typeof parsed.score === "number" ? Math.max(0, Math.min(10, parsed.score)) : 5;
    return {
      score,
      pass: parsed.pass ?? score >= threshold,
      feedback: parsed.feedback ?? "(no feedback)",
    };
  } catch {
    return null;
  }
}
