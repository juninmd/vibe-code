export type LlmFn = (prompt: string, system?: string) => Promise<string | undefined>;

/** OpenAI-compatible chat call (LiteLLM proxy or OpenAI). Returns undefined when unconfigured/failing. */
export const defaultLlm: LlmFn = async (prompt, system) => {
  const base =
    process.env.LITELLM_BASE_URL || (process.env.OPENAI_API_KEY ? "https://api.openai.com" : "");
  if (!base) return undefined;
  const key = process.env.LITELLM_API_KEY || process.env.OPENAI_API_KEY || "";
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.VIBE_AUTOMATION_MODEL || "gpt-4o",
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as any;
    return data?.choices?.[0]?.message?.content;
  } catch {
    return undefined;
  }
};

/** Extracts the first JSON object containing `key` (tolerates fences / prose). */
export function extractJsonObject<T = any>(text: string, key: string): T | null {
  const fenced = new RegExp('```(?:json)?\\s*(\\{[\\s\\S]*"' + key + '"[\\s\\S]*\\})\\s*```').exec(
    text
  );
  const loose = new RegExp('\\{[\\s\\S]*"' + key + '"[\\s\\S]*\\}').exec(text);
  for (const s of [fenced?.[1], loose?.[0]]) {
    if (!s) continue;
    try {
      return JSON.parse(s) as T;
    } catch {}
  }
  return null;
}
