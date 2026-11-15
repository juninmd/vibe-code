import { describe, expect, it } from "bun:test";
import type { Task } from "@vibe-code/shared";
import { buildEnrichmentContext, extractKeywords } from "./enrichment";
import { killWithEscalation } from "./kill-escalation";
import {
  buildExecutionWaves,
  detectDependencyCycles,
  detectFileOverlaps,
  parsePlanValidationResponse,
  validatePlan,
} from "./plan-validation";
import { PrAutomation } from "./pr-automation";
import { parseDuration, ReactionTracker, resolveReaction, shouldEscalate } from "./reactions";
import { buildReviewFingerprint, parsePrNumber, parseReviewDecision } from "./review-monitor";
import {
  extractAcceptanceCriteria,
  formatSpecCompliance,
  verifySpecCompliance,
} from "./spec-compliance";

describe("reactions", () => {
  it("parses durations", () => {
    expect(parseDuration("30m")).toBe(1_800_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("x")).toBeNull();
  });
  it("merges overrides and escalates", () => {
    expect(resolveReaction("ci_failed", { ci_failed: { action: "notify" } }).action).toBe("notify");
    const r = { action: "reinvoke" as const, max_retries: 2, escalate_after: "1h" };
    expect(shouldEscalate(r, 2, Date.now())).toBe(true);
    expect(shouldEscalate(r, 0, Date.now() - 3_700_000)).toBe(true);
    expect(shouldEscalate(r, 1, Date.now())).toBe(false);
  });
  it("tracker reinvokes until budget then notifies", () => {
    const t = new ReactionTracker();
    const cfg = { ci_failed: { action: "reinvoke" as const, max_retries: 2 } };
    expect(t.decide("a", "ci_failed", cfg).action).toBe("reinvoke");
    expect(t.decide("a", "ci_failed", cfg).action).toBe("reinvoke");
    const d = t.decide("a", "ci_failed", cfg);
    expect(d).toMatchObject({ action: "notify", escalate: true });
    t.reset("a");
    expect(t.decide("a", "ci_failed", cfg).action).toBe("reinvoke");
  });
});

describe("review monitor", () => {
  it("decisions, fingerprint, pr number", () => {
    expect(parseReviewDecision("APPROVED")).toBe("approved");
    expect(parseReviewDecision("CHANGES_REQUESTED")).toBe("changes_requested");
    expect(parseReviewDecision(undefined)).toBe("review_pending");
    const c = (id: string) => ({ id, author: "a", body: "b", url: "u" });
    expect(buildReviewFingerprint([c("2"), c("1")])).toBe(buildReviewFingerprint([c("1"), c("2")]));
    expect(buildReviewFingerprint([])).toBe("");
    expect(parsePrNumber("https://github.com/o/r/pull/42")).toBe(42);
  });
});

describe("spec compliance", () => {
  it("extracts criteria", () => {
    expect(extractAcceptanceCriteria("- [ ] a\n- [x] b\n- [ ] c")).toEqual(["a", "c"]);
    expect(extractAcceptanceCriteria("Acceptance Criteria:\n- one\n2. two\n## next")).toEqual([
      "one",
      "two",
    ]);
  });
  it("verifies through injected llm", async () => {
    const llm = async () =>
      '```json\n{"criteria":[{"criterion":"a","met":true,"evidence":"ok"},{"criterion":"b","met":false,"evidence":"no"}]}\n```';
    const r = await verifySpecCompliance("t", "- [ ] a\n- [ ] b", "diff", llm);
    expect(r.success).toBe(false);
    expect(r.unmetCriteria).toEqual(["b: no"]);
    expect(formatSpecCompliance(r.allResults)).toContain("1/2 criteria met");
  });
  it("fails safe without llm / diff", async () => {
    expect((await verifySpecCompliance("t", "- [ ] a", "d", async () => undefined)).success).toBe(
      false
    );
    expect((await verifySpecCompliance("t", "- [ ] a", "  ")).success).toBe(false);
    expect((await verifySpecCompliance("t", "no criteria", "d")).success).toBe(true);
  });
});

describe("plan validation", () => {
  const tasks = [
    { order: 1, title: "A", relevantFiles: ["x.ts"], dependsOn: [] },
    { order: 2, title: "B", relevantFiles: ["x.ts"], dependsOn: [1] },
    { order: 3, title: "C", dependsOn: [1] },
  ];
  it("waves, overlaps, cycles", () => {
    expect(buildExecutionWaves(tasks).map((w) => w.map((t) => t.order))).toEqual([[1], [2, 3]]);
    expect(detectFileOverlaps(tasks)).toEqual([{ file: "x.ts", issues: [1, 2] }]);
    expect(detectDependencyCycles(tasks)).toBeNull();
    expect(
      detectDependencyCycles([
        { order: 1, title: "A", dependsOn: [2] },
        { order: 2, title: "B", dependsOn: [1] },
      ])?.[0]
    ).toContain("Circular");
  });
  it("parses llm output; high severity forces fail", () => {
    const r = parsePlanValidationResponse(
      '{"passed":true,"findings":[{"dimension":"gap_detection","severity":"high","description":"d","suggestion":"s"}]}'
    );
    expect(r?.passed).toBe(false);
  });
  it("validatePlan combines static + llm", async () => {
    const cyc = [
      { order: 1, title: "A", dependsOn: [2] },
      { order: 2, title: "B", dependsOn: [1] },
    ];
    expect((await validatePlan("g", cyc, null, async () => undefined)).passed).toBe(false);
    expect(
      (
        await validatePlan(
          "g",
          [{ order: 1, title: "A", doneCriteria: "x" }],
          null,
          async () => undefined
        )
      ).passed
    ).toBe(true);
  });
});

describe("misc", () => {
  it("keywords drop stop words and code", () => {
    const k = extractKeywords(
      "Implement websocket reconnect `const x` https://a.b with websocket backoff"
    );
    expect(k[0]).toBe("websocket");
    expect(k).not.toContain("with");
  });
  it("enrichment in a non-repo dir is empty", async () => {
    expect(await buildEnrichmentContext("/nonexistent-dir-xyz", "websocket reconnect", "")).toBe(
      ""
    );
  });
  it("kill escalates to SIGKILL unless cancelled", async () => {
    const sig: string[] = [];
    const p = { exitCode: null, kill: (s?: any) => void sig.push(String(s)) };
    killWithEscalation(p, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(sig).toEqual(["SIGTERM", "SIGKILL"]);
    const sig2: string[] = [];
    const cancel = killWithEscalation(
      { exitCode: null, kill: (s?: any) => void sig2.push(String(s)) },
      5
    );
    cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(sig2).toEqual(["SIGTERM"]);
  });
});

describe("PrAutomation", () => {
  const task = {
    id: "t1",
    title: "T",
    description: "",
    status: "review",
    prUrl: "https://github.com/o/r/pull/7",
    branchName: "feat",
    repoId: "r",
  } as unknown as Task;

  const mkFetch = (ci: string, decision: string | null) =>
    (async (url: any, init?: any) => {
      const u = String(url);
      const ok = (b: unknown) => new Response(JSON.stringify(b));
      if (u.includes("/actions/runs?"))
        return ok({
          workflow_runs: [
            { id: 9, name: "ci", status: "completed", conclusion: ci, html_url: "u" },
          ],
        });
      if (u.includes("/jobs"))
        return ok({ jobs: [{ name: "build", conclusion: "failure", html_url: "j" }] });
      if (u.includes("graphql"))
        return ok({ data: { repository: { pullRequest: { reviewDecision: decision } } } });
      if (u.includes("/comments"))
        return ok([{ id: 1, user: { login: "rev" }, body: "fix", html_url: "c" }]);
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

  const make = (fetchFn: typeof fetch) => {
    const calls: { prompt: string }[] = [];
    const notes: string[] = [];
    const a = new PrAutomation({
      listReviewTasks: () => [task],
      getRepoUrl: () => "https://github.com/o/r",
      getToken: () => "tok",
      isRunning: () => false,
      relaunch: async (_t, prompt) => void calls.push({ prompt }),
      notify: async (m) => void notes.push(m),
      fetchFn,
    });
    return { a, calls, notes };
  };

  it("re-invokes the agent once per failed CI run", async () => {
    const { a, calls } = make(mkFetch("failure", null));
    await a.tick();
    await a.tick();
    expect(calls.length).toBe(1);
    expect(calls[0]?.prompt).toContain("Job: build");
  });
  it("re-invokes on new review feedback, not twice for the same", async () => {
    const { a, calls } = make(mkFetch("success", "CHANGES_REQUESTED"));
    await a.tick();
    await a.tick();
    expect(calls.length).toBe(1);
    expect(calls[0]?.prompt).toContain("fix");
  });
  it("notifies on approval", async () => {
    const { a, calls, notes } = make(mkFetch("success", "APPROVED"));
    await a.tick();
    expect(calls.length).toBe(0);
    expect(notes[0]).toContain("PR approved");
  });
});
