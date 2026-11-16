import { defaultLlm, extractJsonObject, type LlmFn } from "./llm";

export interface GeneratedTask {
  title?: string;
  description?: string;
  category?: string;
  priority?: string;
  acceptanceCriteria?: string[];
  relevantFiles?: string[];
  order?: number;
  dependsOn?: number[];
  verifyCommand?: string;
  doneCriteria?: string;
}

export interface ValidationFinding {
  dimension: string;
  severity: "low" | "medium" | "high";
  description: string;
  suggestion: string;
  issueOrder?: number;
}

export interface PlanValidationResult {
  passed: boolean;
  findings: ValidationFinding[];
  refinedIssues?: GeneratedTask[];
}

/** Kahn's algorithm. Null when the graph is a DAG, else a description of the cycle. */
export function detectDependencyCycles(tasks: GeneratedTask[]): string[] | null {
  const nodes = tasks.filter((t) => typeof t.order === "number");
  const adj = new Map<number, number[]>();
  const indeg = new Map<number, number>();
  for (const t of nodes) {
    adj.set(t.order as number, []);
    indeg.set(t.order as number, 0);
  }
  for (const t of nodes) {
    for (const dep of t.dependsOn ?? []) {
      if (!adj.has(dep)) continue;
      adj.get(dep)?.push(t.order as number);
      indeg.set(t.order as number, (indeg.get(t.order as number) ?? 0) + 1);
    }
  }
  const queue = [...indeg].filter(([, d]) => d === 0).map(([o]) => o);
  const sorted = new Set<number>();
  while (queue.length) {
    const n = queue.shift() as number;
    sorted.add(n);
    for (const m of adj.get(n) ?? []) {
      const d = (indeg.get(m) ?? 1) - 1;
      indeg.set(m, d);
      if (d === 0) queue.push(m);
    }
  }
  if (sorted.size === nodes.length) return null;
  const bad = nodes
    .filter((t) => !sorted.has(t.order as number))
    .map((t) => `#${t.order} "${t.title}"`);
  return [`Circular dependency involving: ${bad.join(" -> ")}`];
}

/** Groups tasks into waves; tasks in one wave can run in parallel. */
export function buildExecutionWaves(tasks: GeneratedTask[]): GeneratedTask[][] {
  const byOrder = new Map<number, GeneratedTask>();
  const remaining = new Map<number, Set<number>>();
  for (const t of tasks) {
    if (typeof t.order !== "number") continue;
    byOrder.set(t.order, t);
    remaining.set(t.order, new Set(t.dependsOn ?? []));
  }
  const waves: number[][] = [];
  while (remaining.size > 0) {
    const wave = [...remaining]
      .filter(([, d]) => d.size === 0)
      .map(([o]) => o)
      .sort((a, b) => a - b);
    if (wave.length === 0) {
      waves.push([...remaining.keys()].sort((a, b) => a - b));
      break;
    }
    waves.push(wave);
    for (const o of wave) remaining.delete(o);
    for (const d of remaining.values()) for (const o of wave) d.delete(o);
  }
  return waves.map((w) => w.map((o) => byOrder.get(o) as GeneratedTask));
}

/** Files touched by 2+ tasks (merge-conflict risk). */
export function detectFileOverlaps(
  tasks: GeneratedTask[]
): Array<{ file: string; issues: number[] }> {
  const map = new Map<string, number[]>();
  for (const t of tasks) {
    if (typeof t.order !== "number") continue;
    for (const f of t.relevantFiles ?? []) map.set(f, [...(map.get(f) ?? []), t.order]);
  }
  return [...map].filter(([, i]) => i.length >= 2).map(([file, issues]) => ({ file, issues }));
}

/** Deterministic checks (no LLM): cycles, overlaps, missing verification. */
export function staticPlanFindings(tasks: GeneratedTask[]): ValidationFinding[] {
  const out: ValidationFinding[] = [];
  const cycles = detectDependencyCycles(tasks);
  if (cycles)
    out.push({
      dimension: "dependency_correctness",
      severity: "high",
      description: cycles[0] as string,
      suggestion: "Break the cycle.",
    });
  for (const o of detectFileOverlaps(tasks))
    out.push({
      dimension: "file_scope",
      severity: "medium",
      description: `${o.file} is touched by tasks ${o.issues.join(", ")}`,
      suggestion: "Serialize these tasks with dependsOn.",
    });
  for (const t of tasks)
    if (!t.verifyCommand && !t.doneCriteria && !t.acceptanceCriteria?.length)
      out.push({
        dimension: "verification",
        severity: "low",
        description: `Task #${t.order} "${t.title}" has no verification`,
        suggestion: "Add acceptance criteria or a verify command.",
        issueOrder: t.order,
      });
  return out;
}

export function buildPlanValidationPrompt(
  goal: string,
  issues: GeneratedTask[],
  contextMd?: string | null
): string {
  const block = issues
    .map((i) => {
      const parts = [
        i.dependsOn?.length ? `depends on: ${i.dependsOn.join(", ")}` : "",
        i.relevantFiles?.length ? `files: ${i.relevantFiles.join(", ")}` : "",
        i.acceptanceCriteria?.length ? `criteria: ${i.acceptanceCriteria.join("; ")}` : "",
        i.verifyCommand ? `verify: ${i.verifyCommand}` : "",
      ].filter(Boolean);
      return `${i.order}. ${i.title}${parts.length ? `\n  ${parts.join("\n  ")}` : ""}`;
    })
    .join("\n\n");
  return `You are a plan quality validator. Evaluate whether the plan is well-structured and complete. Do NOT modify files or run commands. Answer in the language of the goal.

## Goal
${goal}
${contextMd ? `\n## Context\n${contextMd}\n` : ""}
## Plan
${block}

## Dimensions
requirement_coverage, task_atomicity, dependency_correctness, file_scope, verification, gap_detection.

Respond with ONLY JSON:
{"passed":true,"findings":[{"dimension":"gap_detection","severity":"low|medium|high","description":"...","suggestion":"..."}],"refinedPlan":null}
Set "passed" false ONLY for high-severity findings; then include "refinedPlan":{"issues":[...]}.`;
}

function refine(parsed: Record<string, any>): GeneratedTask[] | undefined {
  const issues = parsed.refinedPlan?.issues;
  if (!Array.isArray(issues)) return undefined;
  const strs = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return issues
    .filter((i: any) => i && typeof i.title === "string")
    .map((i: any, idx: number) => ({
      title: String(i.title),
      description: typeof i.description === "string" ? i.description : "",
      category: typeof i.category === "string" ? i.category : "feature",
      priority: typeof i.priority === "string" ? i.priority : "media",
      acceptanceCriteria: strs(i.acceptanceCriteria),
      relevantFiles: strs(i.relevantFiles),
      order: typeof i.order === "number" ? i.order : idx + 1,
      dependsOn: Array.isArray(i.dependsOn)
        ? i.dependsOn.filter((d: unknown) => typeof d === "number")
        : [],
      verifyCommand: typeof i.verifyCommand === "string" ? i.verifyCommand : undefined,
      doneCriteria: typeof i.doneCriteria === "string" ? i.doneCriteria : undefined,
    }));
}

export function parsePlanValidationResponse(output: string): PlanValidationResult | null {
  const p = extractJsonObject<Record<string, any>>(output, "findings");
  if (!p || !Array.isArray(p.findings)) return null;
  const high = p.findings.some((f: ValidationFinding) => f.severity === "high");
  return {
    passed: high ? false : p.passed !== false,
    findings: p.findings,
    refinedIssues: refine(p),
  };
}

/** Static checks first; LLM review is best-effort (skipped when no LLM is configured). */
export async function validatePlan(
  goal: string,
  tasks: GeneratedTask[],
  contextMd?: string | null,
  llm: LlmFn = defaultLlm
): Promise<PlanValidationResult> {
  const findings = staticPlanFindings(tasks);
  const out = await llm(
    buildPlanValidationPrompt(goal, tasks, contextMd),
    "You return JSON plan validation results."
  );
  const parsed = out ? parsePlanValidationResponse(out) : null;
  const all = [...findings, ...(parsed?.findings ?? [])];
  const passed = !all.some((f) => f.severity === "high") && (parsed?.passed ?? true);
  return { passed, findings: all, refinedIssues: parsed?.refinedIssues };
}
