import { defaultLlm, extractJsonObject, type LlmFn } from "./llm";

export interface CriterionResult {
  criterion: string;
  met: boolean;
  evidence: string;
}

export interface SpecComplianceResult {
  success: boolean;
  unmetCriteria: string[];
  allResults: CriterionResult[];
}

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");

export function formatSpecCompliance(results: CriterionResult[]): string {
  const met = results.filter((r) => r.met).length;
  const rows = results.map(
    (r) => `| ${esc(r.criterion)} | ${r.met ? "Met" : "Not Met"} | ${esc(r.evidence)} |`
  );
  return [
    "",
    "---",
    "## Spec Compliance",
    "",
    `**${met}/${results.length} criteria met**`,
    "",
    "| Criterion | Status | Evidence |",
    "|-----------|--------|----------|",
    ...rows,
  ].join("\n");
}

/** Pulls acceptance criteria from `- [ ]` items or an "Acceptance Criteria" section. */
export function extractAcceptanceCriteria(description: string): string[] {
  const out: string[] = [];
  for (const m of description.matchAll(/^[\t ]*- \[ \]\s*(.+)$/gm)) if (m[1]) out.push(m[1].trim());
  if (out.length > 0) return out;
  const h = /(?:acceptance criteria|crit[ée]rios de aceite|expected behavior)[:\s]*\n/i.exec(
    description
  );
  if (!h) return out;
  for (const line of description.slice(h.index + h[0].length).split("\n")) {
    const t = line.trim();
    if (t.startsWith("#") || t.startsWith("---")) break;
    const m = /^[-*]\s+(.+)$/.exec(t) ?? /^\d+[.)]\s+(.+)$/.exec(t);
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}

export function buildCompliancePrompt(title: string, criteria: string[], diff: string): string {
  const list = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return `You are a spec compliance validator. Check if the implementation satisfies the acceptance criteria. Do NOT modify files or run commands.

## Task
${title}

## Acceptance Criteria
${list}

## Implementation (git diff)
\`\`\`diff
${diff.slice(0, 100_000)}
\`\`\`

Respond with ONLY a JSON object:
{"criteria":[{"criterion":"text","met":true,"evidence":"why"}],"summary":"X/Y criteria met","passed":false}`;
}

export function buildComplianceRecoveryPrompt(
  title: string,
  unmet: { criterion: string; evidence: string }[]
): string {
  const list = unmet
    .map((c, i) => `${i + 1}. **${c.criterion}**\n   Reason: ${c.evidence}`)
    .join("\n\n");
  return `You are continuing work on: "${title}".
These acceptance criteria were NOT met:

${list}

Fix ONLY these. Commit and push to the current branch. Do not create a new branch or a PR.`;
}

export async function verifySpecCompliance(
  title: string,
  description: string,
  diff: string,
  llm: LlmFn = defaultLlm
): Promise<SpecComplianceResult> {
  const criteria = extractAcceptanceCriteria(description);
  if (criteria.length === 0) return { success: true, unmetCriteria: [], allResults: [] };
  const fail = (evidence: string, msg: string): SpecComplianceResult => ({
    success: false,
    unmetCriteria: [msg],
    allResults: criteria.map((criterion) => ({ criterion, met: false, evidence })),
  });
  if (!diff.trim()) return fail("Diff is empty", "Diff is empty, cannot verify criteria");

  const content = await llm(
    buildCompliancePrompt(title, criteria, diff),
    "You return JSON objects representing spec compliance results."
  );
  if (!content) return fail("LLM unavailable", "Failed to verify criteria: LLM unavailable");
  const parsed = extractJsonObject<{ criteria?: CriterionResult[] }>(content, "criteria");
  if (!parsed || !Array.isArray(parsed.criteria))
    return fail("Parse error", "Invalid LLM response for spec verification");
  return {
    success: parsed.criteria.every((c) => c.met !== false),
    unmetCriteria: parsed.criteria
      .filter((c) => c.met === false)
      .map((c) => `${c.criterion}: ${c.evidence}`),
    allResults: parsed.criteria,
  };
}
