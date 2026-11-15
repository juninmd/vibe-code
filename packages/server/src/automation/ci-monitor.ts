export type CiStatus = "pending" | "success" | "failure" | "not_found";

export interface CiRun {
  status: CiStatus;
  id: string;
  name: string;
  url: string;
}

type Fetch = typeof fetch;

/** Parses "owner/repo" from a GitHub URL or slug. */
export function parseGitHubSlug(repo: string): string | null {
  const m =
    repo.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?/i) ?? repo.match(/^([^/\s]+\/[^/\s]+)$/);
  return m ? (m[1] as string) : null;
}

const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "vibe-code",
});

/** Single (non-blocking) poll of the latest GitHub Actions run for a branch. */
export async function pollGitHubCi(
  slug: string,
  branch: string,
  token: string,
  f: Fetch = fetch
): Promise<CiRun | null> {
  try {
    const res = await f(
      `https://api.github.com/repos/${slug}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`,
      { headers: ghHeaders(token) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { workflow_runs?: Record<string, any>[] };
    const run = data.workflow_runs?.[0];
    if (!run) return null;
    const status: CiStatus =
      run.status === "completed"
        ? run.conclusion === "success"
          ? "success"
          : "failure"
        : "pending";
    return { status, id: String(run.id), name: run.name, url: run.html_url };
  } catch {
    return null;
  }
}

/** Summarises failed jobs/steps of a run (logs endpoint is a zip, so we use job metadata). */
export async function extractGitHubCiLogs(
  slug: string,
  runId: string,
  token: string,
  f: Fetch = fetch
): Promise<string> {
  try {
    const res = await f(`https://api.github.com/repos/${slug}/actions/runs/${runId}/jobs`, {
      headers: ghHeaders(token),
    });
    if (!res.ok) return `Failed to read CI jobs: ${res.status}`;
    const data = (await res.json()) as { jobs?: Record<string, any>[] };
    const failed = (data.jobs ?? []).filter((j) => j.conclusion === "failure");
    if (failed.length === 0) return "CI failed; no failed job details available.";
    return failed
      .map((j) => {
        const steps = ((j.steps ?? []) as Record<string, any>[])
          .filter((s) => s.conclusion === "failure")
          .map((s) => `  - step: ${s.name}`)
          .join("\n");
        return `Job: ${j.name}\nURL: ${j.html_url}${steps ? `\n${steps}` : ""}`;
      })
      .join("\n\n");
  } catch (err) {
    return `Failed to read CI jobs: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Single poll of the latest CircleCI pipeline for a branch. */
export async function pollCircleCi(
  projectSlug: string,
  branch: string,
  token: string,
  f: Fetch = fetch
): Promise<CiRun | null> {
  try {
    const h = { "Circle-Token": token, Accept: "application/json" };
    const p = await f(
      `https://circleci.com/api/v2/project/${projectSlug}/pipeline?branch=${encodeURIComponent(branch)}`,
      { headers: h }
    );
    if (!p.ok) return null;
    const pipeline = ((await p.json()) as { items?: Record<string, any>[] }).items?.[0];
    if (!pipeline) return null;
    const w = await f(`https://circleci.com/api/v2/pipeline/${pipeline.id}/workflow`, {
      headers: h,
    });
    if (!w.ok) return null;
    const wf = ((await w.json()) as { items?: Record<string, any>[] }).items ?? [];
    if (wf.length === 0) return null;
    const bad = (s: string) => ["failed", "failing", "error"].includes(s);
    const status: CiStatus = wf.some((x) => bad(x.status))
      ? "failure"
      : wf.every((x) => x.status === "success")
        ? "success"
        : "pending";
    return {
      status,
      id: String(pipeline.id),
      name: `Pipeline ${pipeline.number}`,
      url: `https://app.circleci.com/pipelines/${projectSlug}/${pipeline.number}`,
    };
  } catch {
    return null;
  }
}

export function buildCiRecoveryPrompt(title: string, ciLogs: string, branch: string): string {
  return `You are continuing work on: "${title}".
A pull request exists for your changes, but CI failed. Fix the errors and push to the existing branch.

## CI Failure Details

\`\`\`
${ciLogs}
\`\`\`

## Instructions
1. Find the root cause of each failure.
2. Fix the code and commit with a conventional commit message.
3. Push to the existing branch: \`git push origin ${branch}\` (if rejected: \`git pull --rebase origin ${branch}\`, then push).

Do NOT create a new branch or a new PR.`;
}
