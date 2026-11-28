/**
 * PR publication grants (issue #262).
 *
 * Publishing a pull request needs an explicit authorization recorded before the
 * push: who authorized, where it came from (a person's message, the API button
 * or a routine toggle), which turn, repository, head branch and target branch.
 * Agent output, files and MCP responses never create a grant - only the user
 * endpoints and message parsing here do.
 *
 * A grant is bound to the branch pair. A later message, a cancellation or a
 * branch change invalidates it.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db";

export type PrGrantSource = "explicit_command" | "api_request" | "routine_toggle";

export interface PrGrantRow {
  id: string;
  task_id: string;
  account_id: string | null;
  source: PrGrantSource;
  turn_id: string | null;
  repo_id: string;
  head_branch: string;
  target_branch: string;
  created_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export interface GrantPrInput {
  taskId: string;
  accountId?: string | null;
  source: PrGrantSource;
  turnId?: string | null;
  repoId: string;
  headBranch: string;
  targetBranch: string;
}

/** Creates a grant, or returns the active one for the same branch pair. */
export function grantPr(db: Db, input: GrantPrInput): PrGrantRow {
  const existing = findActiveGrant(db, input.taskId, {
    repoId: input.repoId,
    headBranch: input.headBranch,
    targetBranch: input.targetBranch,
  });
  if (existing) {
    // A newer explicit request supersedes the older source/turn on the grant.
    db.raw
      .prepare("UPDATE pr_grants SET source = ?, account_id = ?, turn_id = ? WHERE id = ?")
      .run(input.source, input.accountId ?? null, input.turnId ?? null, existing.id);
    return getGrant(db, existing.id) as PrGrantRow;
  }
  const id = `prg-${randomUUID()}`;
  db.raw
    .prepare(
      `INSERT INTO pr_grants
         (id, task_id, account_id, source, turn_id, repo_id, head_branch, target_branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.taskId,
      input.accountId ?? null,
      input.source,
      input.turnId ?? null,
      input.repoId,
      input.headBranch,
      input.targetBranch
    );
  const row = getGrant(db, id);
  if (!row) throw new Error("Failed to record the PR grant");
  return row;
}

export function getGrant(db: Db, id: string): PrGrantRow | null {
  return db.raw.query<PrGrantRow, [string]>("SELECT * FROM pr_grants WHERE id = ?").get(id) ?? null;
}

export function findActiveGrant(
  db: Db,
  taskId: string,
  match: { repoId: string; headBranch: string; targetBranch: string }
): PrGrantRow | null {
  return (
    db.raw
      .query<PrGrantRow, [string, string, string, string]>(
        `SELECT * FROM pr_grants
          WHERE task_id = ? AND repo_id = ? AND head_branch = ? AND target_branch = ?
            AND consumed_at IS NULL AND revoked_at IS NULL
          ORDER BY created_at DESC LIMIT 1`
      )
      .get(taskId, match.repoId, match.headBranch, match.targetBranch) ?? null
  );
}

export function consumeGrant(db: Db, id: string): void {
  db.raw
    .prepare(
      "UPDATE pr_grants SET consumed_at = datetime('now') WHERE id = ? AND consumed_at IS NULL"
    )
    .run(id);
}

export function revokeGrant(db: Db, id: string, reason: string): void {
  db.raw
    .prepare(
      "UPDATE pr_grants SET revoked_at = datetime('now'), revoked_reason = ? WHERE id = ? AND revoked_at IS NULL"
    )
    .run(reason, id);
}

/** Cancel/stop: no pending authorization survives. */
export function revokeTaskGrants(db: Db, taskId: string, reason: string): number {
  const result = db.raw
    .prepare(
      `UPDATE pr_grants
          SET revoked_at = datetime('now'), revoked_reason = ?
        WHERE task_id = ? AND revoked_at IS NULL AND consumed_at IS NULL`
    )
    .run(reason, taskId);
  return Number(result.changes ?? 0);
}

export function listGrants(db: Db, taskId: string): PrGrantRow[] {
  return db.raw
    .query<PrGrantRow, [string]>(
      "SELECT * FROM pr_grants WHERE task_id = ? ORDER BY created_at DESC"
    )
    .all(taskId);
}

const NEGATION = /\b(nao|nunca|jamais)\b/;
const PR_REQUEST =
  /^(por favor,?\s*)?(quero que (voc[eê]|vc)\s+)?(abra|abrir|abre|crie|criar|cria|publique|publicar|gere|gerar|open|create|publish|make)\b[^.!?]{0,80}\b(pr|pull\s+request|merge\s+request)\b/;

/**
 * True only for an explicit order to publish a PR ("abra um PR", "create a pull
 * request"). The verb has to open the sentence (optionally after "por favor" or
 * "quero que você"), so questions, possibilities, descriptions and negations do
 * not authorize anything.
 */
export function detectExplicitPrRequest(text: string): boolean {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const sentences = normalized
    .split(/[\n.!;]+/)
    .map((sentence) => sentence.replace(/^[\s>*#\-\d.)]+/, "").trim())
    .filter(Boolean);
  for (const sentence of sentences) {
    if (sentence.includes("?")) continue;
    if (NEGATION.test(sentence)) continue;
    if (PR_REQUEST.test(sentence)) return true;
  }
  return false;
}
