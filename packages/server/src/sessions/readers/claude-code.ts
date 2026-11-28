import { join } from "node:path";
import type { RawSession, SessionReader } from "../types";
import {
  dirExists,
  expandHome,
  readLines,
  safeMtime,
  safeReaddir,
  toEpochMs,
  toTitle,
} from "../util";

/**
 * Claude Code keeps one JSONL transcript per session under
 * `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`. Every line is a
 * record; we stream them and keep only what a card shows.
 */
const DEFAULT_ROOTS = ["~/.claude/projects"];

interface TranscriptRecord {
  type?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  summary?: string;
  isMeta?: boolean;
  isApiErrorMessage?: boolean;
  message?: { role?: string; content?: unknown };
}

/** Slash-command envelopes and system caveats are noise in a card title. */
const TITLE_NOISE = /^(<command-|<local-command-|Caveat: The messages below)/;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: string }).text === "string"
    )
    .map((block) => block.text)
    .join("\n");
}

function parseTranscript(file: string, records: AsyncGenerator<string>) {
  return (async () => {
    let sessionId = "";
    let cwd = "";
    let branch: string | null = null;
    let summary = "";
    let firstPrompt = "";
    let messageCount = 0;
    let createdAt = 0;
    let updatedAt = 0;
    let lastWasError = false;

    for await (const line of records) {
      if (!line.trim()) continue;
      let rec: TranscriptRecord;
      try {
        rec = JSON.parse(line) as TranscriptRecord;
      } catch {
        continue; // partially-written line while the CLI is running
      }

      if (rec.sessionId) sessionId = rec.sessionId;
      if (rec.cwd) cwd = rec.cwd;
      if (rec.gitBranch) branch = rec.gitBranch;
      if (rec.type === "summary" && typeof rec.summary === "string" && rec.summary.trim()) {
        summary = rec.summary;
        continue;
      }
      if (rec.type !== "user" && rec.type !== "assistant") continue;

      messageCount++;
      lastWasError = rec.isApiErrorMessage === true;

      const ts = toEpochMs(rec.timestamp);
      if (ts > 0) {
        if (createdAt === 0) createdAt = ts;
        if (ts > updatedAt) updatedAt = ts;
      }

      if (!firstPrompt && rec.type === "user" && !rec.isMeta) {
        const text = textOf(rec.message?.content).trim();
        if (text && !TITLE_NOISE.test(text)) firstPrompt = text;
      }
    }

    if (messageCount === 0) return null;

    const mtime = await safeMtime(file);
    return {
      sessionId,
      cwd,
      branch,
      messageCount,
      title: toTitle(summary || firstPrompt, "Untitled session"),
      createdAt: createdAt || mtime,
      updatedAt: updatedAt || mtime,
      lastWasError,
    };
  })();
}

export class ClaudeCodeSessionReader implements SessionReader {
  readonly source = "claude-code" as const;

  constructor(private readonly configuredRoots: string[] = resolveRoots()) {}

  roots(): string[] {
    return this.configuredRoots;
  }

  async read(): Promise<RawSession[]> {
    const sessions: RawSession[] = [];

    for (const root of this.configuredRoots) {
      if (!(await dirExists(root))) continue;

      for (const projectDir of await safeReaddir(root)) {
        const dir = join(root, projectDir);
        if (!(await dirExists(dir))) continue;

        for (const fileName of await safeReaddir(dir)) {
          if (!fileName.endsWith(".jsonl")) continue;
          const file = join(dir, fileName);
          const parsed = await parseTranscript(file, readLines(file));
          if (!parsed) continue;

          sessions.push({
            sessionId: parsed.sessionId || fileName.replace(/\.jsonl$/, ""),
            source: this.source,
            title: parsed.title,
            cwd: parsed.cwd || projectDir,
            branch: parsed.branch,
            messageCount: parsed.messageCount,
            createdAt: parsed.createdAt,
            updatedAt: parsed.updatedAt,
            explicitStatus: parsed.lastWasError ? "failed" : null,
          });
        }
      }
    }

    return sessions;
  }
}

function resolveRoots(): string[] {
  const override = process.env.VIBE_CLAUDE_SESSIONS_DIR;
  return (override ? override.split(",") : DEFAULT_ROOTS)
    .map((p) => expandHome(p.trim()))
    .filter(Boolean);
}
