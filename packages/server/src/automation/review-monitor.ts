import { createHash } from "node:crypto";
import { parseGitHubSlug } from "./ci-monitor";

export interface ReviewComment {
  id: string;
  author: string;
  body: string;
  path?: string;
  line?: number;
  url: string;
}

export type ReviewDecision = "approved" | "changes_requested" | "review_pending";

type Fetch = typeof fetch;

export function parseReviewDecision(decision: string | undefined): ReviewDecision {
  if (decision === "APPROVED") return "approved";
  if (decision === "CHANGES_REQUESTED") return "changes_requested";
  return "review_pending";
}

/** Stable id of a comment set, so the same feedback is never processed twice. */
export function buildReviewFingerprint(comments: ReviewComment[]): string {
  if (comments.length === 0) return "";
  const ids = comments.map((c) => c.id).sort();
  return createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 16);
}

export function parsePrNumber(prUrl: string): number | null {
  const m = prUrl.match(/\/pull\/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function buildReviewRecoveryPrompt(
  task: { id: string; title: string },
  comments: ReviewComment[],
  branch: string
): string {
  const sections = comments
    .map((c) => {
      const loc = c.path ? `**File:** \`${c.path}\`:${c.line ?? "general"}` : "**General comment**";
      return `### ${c.author}\n${loc}\n\n${c.body}`;
    })
    .join("\n\n---\n\n");
  return `You are addressing pull request review feedback. Push fixes to the existing branch; never open a new branch or PR. Run unattended: do not ask questions.

## Task
- **ID:** ${task.id}
- **Title:** ${task.title}

## Review Comments

${sections}

## Instructions
1. Address every comment.
2. Commit with \`fix: address review feedback\`.
3. Push: \`git push origin ${branch}\` (if rejected: \`git pull --rebase origin ${branch}\`, then push).
Do not refactor unrelated code.`;
}

export async function fetchReviewDecision(
  repo: string,
  prNumber: number,
  token: string,
  f: Fetch = fetch
): Promise<ReviewDecision> {
  const slug = parseGitHubSlug(repo);
  if (!slug) return "review_pending";
  const [owner, name] = slug.split("/");
  try {
    const res = await f("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "vibe-code",
      },
      body: JSON.stringify({
        query: `query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){reviewDecision}}}`,
        variables: { o: owner, n: name, p: prNumber },
      }),
    });
    if (!res.ok) return "review_pending";
    const data = (await res.json()) as any;
    return parseReviewDecision(data?.data?.repository?.pullRequest?.reviewDecision);
  } catch {
    return "review_pending";
  }
}

export async function fetchReviewComments(
  repo: string,
  prNumber: number,
  token: string,
  f: Fetch = fetch
): Promise<ReviewComment[]> {
  const slug = parseGitHubSlug(repo);
  if (!slug) return [];
  try {
    const res = await f(
      `https://api.github.com/repos/${slug}/pulls/${prNumber}/comments?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "vibe-code",
        },
      }
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Record<string, any>[];
    return rows.map((r) => ({
      id: String(r.id),
      author: r.user?.login ?? "unknown",
      body: r.body ?? "",
      path: r.path,
      line: r.line ?? undefined,
      url: r.html_url,
    }));
  } catch {
    return [];
  }
}

/** Unified diff of a PR (GitHub). Empty string on failure. */
export async function fetchPrDiff(
  repo: string,
  prNumber: number,
  token: string,
  f: Fetch = fetch
): Promise<string> {
  const slug = parseGitHubSlug(repo);
  if (!slug) return "";
  try {
    const res = await f(`https://api.github.com/repos/${slug}/pulls/${prNumber}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3.diff",
        "User-Agent": "vibe-code",
      },
    });
    return res.ok ? await res.text() : "";
  } catch {
    return "";
  }
}
