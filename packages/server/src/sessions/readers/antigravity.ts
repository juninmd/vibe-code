import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { basename, join } from "node:path";
import type { RawSession, SessionReader } from "../types";
import {
  dirExists,
  expandHome,
  pick,
  readLines,
  safeMtime,
  safeReadJson,
  toEpochMs,
  toTitle,
} from "../util";

/**
 * Antigravity CLI reader.
 *
 * Its on-disk session store is not a stable published contract, so this reader
 * is schema-tolerant rather than schema-bound: it accepts a session object, an
 * array of them, a `{ sessions: [...] }` wrapper, or a JSONL event log, and
 * resolves each card field from a list of aliases. Point
 * `VIBE_ANTIGRAVITY_SESSIONS_DIR` at the real store (comma-separated for more
 * than one) when the defaults below don't match a given install.
 */
const DEFAULT_ROOTS = [
  "~/.antigravity/sessions",
  "~/.antigravity/cli/sessions",
  "~/.config/antigravity/sessions",
  // The `agy` CLI keeps its conversations in a JSONL history index. It is not a
  // per-session store, so it is read separately (grouped by conversationId).
  "~/.gemini/antigravity-cli",
];

const ID_KEYS = ["id", "sessionId", "session_id", "conversationId", "conversation_id"];
/** Keys that identify a *conversation*, used when one file indexes many of them. */
const CONVERSATION_KEYS = ["conversationId", "conversation_id"];
const TITLE_KEYS = ["title", "name", "summary", "task", "prompt", "description"];
const CWD_KEYS = [
  "cwd",
  "directory",
  "workspace",
  "workspacePath",
  "workspace_path",
  "projectPath",
];
const CREATED_KEYS = ["createdAt", "created_at", "created", "startedAt", "started_at", "startTime"];
const UPDATED_KEYS = [
  "updatedAt",
  "updated_at",
  "updated",
  "lastActiveAt",
  "last_active_at",
  "endedAt",
  "modifiedAt",
];
const STATUS_KEYS = ["status", "state", "result", "outcome"];
const COUNT_KEYS = ["messageCount", "message_count", "turnCount", "turns"];

const DONE_STATES = new Set(["done", "completed", "complete", "finished", "success", "succeeded"]);
const FAILED_STATES = new Set(["failed", "error", "errored", "aborted", "cancelled", "canceled"]);

type Loose = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Fields that *name or locate* a session. Deliberately narrower than everything the reader
 * understands: a timestamp, a status or a count alone is not enough to tell a session from a
 * config/manifest file that happens to carry one.
 */
const SESSION_FIELD_KEYS = [
  ...ID_KEYS,
  ...TITLE_KEYS,
  ...CWD_KEYS,
  "messages",
  "events",
  "turns",
  "history",
];

/**
 * Distinguishes a session object from a configuration file. Both are plain JSON objects in
 * the same store, and only the former carries a field that names or describes a session.
 */
function looksLikeSession(obj: Loose): boolean {
  return SESSION_FIELD_KEYS.some((key) => {
    const value = obj[key];
    return value !== undefined && value !== null && value !== "";
  });
}

function normalizeStatus(value: unknown): "done" | "failed" | null {
  const raw = str(value).toLowerCase();
  if (!raw) return null;
  if (DONE_STATES.has(raw)) return "done";
  if (FAILED_STATES.has(raw)) return "failed";
  return null;
}

function messageCountOf(obj: Loose): number {
  const explicit = pick(obj, COUNT_KEYS);
  if (typeof explicit === "number" && Number.isFinite(explicit)) return Math.max(0, explicit);
  for (const key of ["messages", "events", "turns", "history"]) {
    const value = obj[key];
    if (Array.isArray(value)) return value.length;
  }
  return 0;
}

/** Times can live under a nested `time` object, as in other CLI stores. */
function timeOf(obj: Loose, keys: string[]): number {
  const direct = toEpochMs(pick(obj, keys));
  if (direct > 0) return direct;
  const nested = obj.time;
  if (nested && typeof nested === "object") {
    return toEpochMs(pick(nested as Loose, ["updated", "created", "start", "end"]));
  }
  return 0;
}

function toRawSession(obj: Loose, file: string, mtime: number): RawSession | null {
  const sessionId = str(pick(obj, ID_KEYS)) || basename(file).replace(/\.jsonl?$/, "");
  if (!sessionId) return null;

  const created = timeOf(obj, CREATED_KEYS) || mtime;
  const updated = timeOf(obj, UPDATED_KEYS) || created;

  return {
    sessionId,
    source: "antigravity",
    title: toTitle(str(pick(obj, TITLE_KEYS)), "Untitled session"),
    cwd: str(pick(obj, CWD_KEYS)),
    branch: str(pick(obj, ["branch", "gitBranch", "git_branch"])) || null,
    messageCount: messageCountOf(obj),
    createdAt: created,
    updatedAt: updated,
    explicitStatus: normalizeStatus(pick(obj, STATUS_KEYS)),
  };
}

/** Folds a JSONL event log down to the handful of fields a card needs. */
async function readEventLog(file: string, mtime: number): Promise<RawSession | null> {
  const merged: Loose = {};
  let messageCount = 0;
  let firstText = "";
  let created = 0;
  let updated = 0;
  let status: "done" | "failed" | null = null;

  for await (const line of readLines(file)) {
    if (!line.trim()) continue;
    let rec: Loose;
    try {
      rec = JSON.parse(line) as Loose;
    } catch {
      continue;
    }

    for (const key of [...ID_KEYS, ...CWD_KEYS, ...TITLE_KEYS]) {
      if (merged[key] === undefined && rec[key] !== undefined) merged[key] = rec[key];
    }

    const ts = timeOf(rec, [...UPDATED_KEYS, ...CREATED_KEYS, "timestamp", "ts"]);
    if (ts > 0) {
      if (created === 0) created = ts;
      if (ts > updated) updated = ts;
    }

    const eventStatus = normalizeStatus(pick(rec, STATUS_KEYS));
    if (eventStatus) status = eventStatus;

    const role = str(pick(rec, ["role", "type", "kind"]));
    if (role === "user" || role === "assistant" || role === "message") {
      messageCount++;
      if (!firstText && role !== "assistant") {
        const content = rec.content ?? rec.text ?? rec.message;
        if (typeof content === "string") firstText = content;
      }
    }
  }

  if (messageCount === 0 && Object.keys(merged).length === 0) return null;

  const session = toRawSession(merged, file, mtime);
  if (!session) return null;

  return {
    ...session,
    title: session.title === "Untitled session" ? toTitle(firstText, session.title) : session.title,
    messageCount: messageCount || session.messageCount,
    createdAt: created || session.createdAt,
    updatedAt: updated || session.updatedAt,
    explicitStatus: status ?? session.explicitStatus,
  };
}

async function collectFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(full, depth + 1)));
    else if (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl")) files.push(full);
  }
  return files;
}

/**
 * Reads the CLI's `history.jsonl` index, which holds one line per interaction across
 * *all* conversations. Entries are grouped by `conversationId` so each conversation
 * becomes one session, with the last message as its title.
 */
async function readHistoryIndex(file: string): Promise<RawSession[]> {
  interface Entry {
    title: string;
    cwd: string;
    created: number;
    updated: number;
    count: number;
  }
  const byConversation = new Map<string, Entry>();

  for await (const line of readLines(file)) {
    if (!line.trim()) continue;
    let rec: Loose;
    try {
      rec = JSON.parse(line) as Loose;
    } catch {
      continue;
    }

    // The index is grouped per *conversation*: `conversationId` must win over any per-line
    // message id, or every interaction would become its own card.
    const id = str(pick(rec, [...CONVERSATION_KEYS, ...ID_KEYS]));
    if (!id) continue;

    const ts = timeOf(rec, ["timestamp", "ts", ...UPDATED_KEYS, ...CREATED_KEYS]);
    const text = str(pick(rec, ["display", "text", "message", ...TITLE_KEYS]));
    const cwd = str(pick(rec, CWD_KEYS));

    const entry = byConversation.get(id);
    if (!entry) {
      byConversation.set(id, { title: text, cwd, created: ts, updated: ts, count: 1 });
      continue;
    }

    entry.count += 1;
    if (ts > 0 && (entry.created === 0 || ts < entry.created)) entry.created = ts;
    if (ts >= entry.updated) {
      entry.updated = ts;
      entry.title = text || entry.title;
      entry.cwd = cwd || entry.cwd;
    }
  }

  return [...byConversation.entries()].map(([id, entry]) => ({
    sessionId: id,
    source: "antigravity" as const,
    title: toTitle(entry.title, "Untitled session"),
    cwd: entry.cwd,
    branch: null,
    messageCount: entry.count,
    createdAt: entry.created || entry.updated,
    updatedAt: entry.updated || entry.created,
    explicitStatus: null,
  }));
}

export class AntigravitySessionReader implements SessionReader {
  readonly source = "antigravity" as const;

  constructor(private readonly configuredRoots: string[] = resolveRoots()) {}

  roots(): string[] {
    return this.configuredRoots;
  }

  async read(): Promise<RawSession[]> {
    const sessions: RawSession[] = [];

    for (const root of this.configuredRoots) {
      if (!(await dirExists(root))) continue;

      // The `agy` CLI store keeps its conversations in a shared history index (plus
      // SQLite/protobuf files we do not parse), so it is read directly. Walking the whole
      // tree would be both slow — it holds thousands of cache/log files — and useless.
      const historyFile = join(root, "history.jsonl");
      if (existsSync(historyFile)) {
        sessions.push(...(await readHistoryIndex(historyFile)));
        continue;
      }

      for (const file of await collectFiles(root)) {
        const mtime = await safeMtime(file);

        if (file.endsWith(".jsonl")) {
          const session = await readEventLog(file, mtime);
          if (session) sessions.push(session);
          continue;
        }

        const raw = await safeReadJson<unknown>(file);
        for (const candidate of unwrap(raw)) {
          // Configuration files (`settings.json`, `mcp_config.json`) describe no session and
          // must not become cards. A file is a session when it names one (an id) or describes
          // one (a title, a cwd, timestamps) — so the filename fallback still works for stores
          // that key sessions by filename alone.
          if (!looksLikeSession(candidate)) continue;
          const session = toRawSession(candidate, file, mtime);
          if (session) sessions.push(session);
        }
      }
    }

    return sessions;
  }
}

/** Accepts a session object, an array of them, or a `{ sessions: [...] }` wrapper. */
function unwrap(raw: unknown): Loose[] {
  if (Array.isArray(raw)) return raw.filter((r): r is Loose => !!r && typeof r === "object");
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Loose;
  const nested = obj.sessions;
  if (Array.isArray(nested)) return nested.filter((r): r is Loose => !!r && typeof r === "object");
  return [obj];
}

function resolveRoots(): string[] {
  const override = process.env.VIBE_ANTIGRAVITY_SESSIONS_DIR;
  return (override ? override.split(",") : DEFAULT_ROOTS)
    .map((p) => expandHome(p.trim()))
    .filter(Boolean);
}
