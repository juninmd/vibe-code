import type {
  SessionBoardResponse,
  SessionCard,
  SessionCardStatus,
  SessionSource,
  SessionSourceStatus,
} from "@vibe-code/shared";
import { AntigravitySessionReader } from "./readers/antigravity";
import { ClaudeCodeSessionReader } from "./readers/claude-code";
import { OpenCodeSessionReader } from "./readers/opencode";
import type { RawSession, SessionReader } from "./types";
import { dirExists, shortenProject } from "./util";

/** A session touched within this window is still being worked on. */
const DEFAULT_ACTIVE_WINDOW_MS = 15 * 60_000;
/** Beyond this, a session is treated as closed rather than merely paused. */
const DEFAULT_IDLE_WINDOW_MS = 24 * 60 * 60_000;
/** Board polls are frequent; disk scans are not free. */
const DEFAULT_CACHE_TTL_MS = 5_000;

export interface SessionServiceOptions {
  readers?: SessionReader[];
  activeWindowMs?: number;
  idleWindowMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export interface ListSessionsOptions {
  source?: SessionSource;
  limit?: number;
  refresh?: boolean;
}

/**
 * Derives the kanban column for a session.
 *
 * A CLI that records its own terminal state wins; otherwise the column comes
 * from how recently the session was touched.
 */
export function deriveStatus(
  session: Pick<RawSession, "updatedAt" | "explicitStatus">,
  now: number,
  activeWindowMs: number,
  idleWindowMs: number
): SessionCardStatus {
  if (session.explicitStatus === "failed") return "failed";
  if (session.explicitStatus === "done") return "done";

  const age = now - session.updatedAt;
  if (age <= activeWindowMs) return "active";
  if (age <= idleWindowMs) return "idle";
  return "done";
}

export class SessionService {
  private readonly readers: SessionReader[];
  private readonly activeWindowMs: number;
  private readonly idleWindowMs: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private cache: { at: number; response: SessionBoardResponse } | null = null;
  private inflight: Promise<SessionBoardResponse> | null = null;

  constructor(options: SessionServiceOptions = {}) {
    this.readers = options.readers ?? [
      new OpenCodeSessionReader(),
      new ClaudeCodeSessionReader(),
      new AntigravitySessionReader(),
    ];
    this.activeWindowMs =
      options.activeWindowMs ??
      envNumber("VIBE_SESSION_ACTIVE_WINDOW_MS", DEFAULT_ACTIVE_WINDOW_MS);
    this.idleWindowMs =
      options.idleWindowMs ?? envNumber("VIBE_SESSION_IDLE_WINDOW_MS", DEFAULT_IDLE_WINDOW_MS);
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async list(options: ListSessionsOptions = {}): Promise<SessionBoardResponse> {
    const board = await this.scan(options.refresh === true);

    let cards = board.cards;
    if (options.source) cards = cards.filter((card) => card.source === options.source);
    if (options.limit !== undefined && options.limit >= 0) cards = cards.slice(0, options.limit);

    return cards === board.cards ? board : { ...board, cards };
  }

  /** Scans every store, honouring the short cache unless `force` is set. */
  private async scan(force: boolean): Promise<SessionBoardResponse> {
    const now = this.now();
    if (!force && this.cache && now - this.cache.at < this.cacheTtlMs) return this.cache.response;
    if (this.inflight) return this.inflight;

    this.inflight = this.scanNow()
      .then((response) => {
        this.cache = { at: this.now(), response };
        return response;
      })
      .finally(() => {
        this.inflight = null;
      });

    return this.inflight;
  }

  private async scanNow(): Promise<SessionBoardResponse> {
    const now = this.now();
    const cards: SessionCard[] = [];
    const sources: SessionSourceStatus[] = [];

    const results = await Promise.all(
      this.readers.map(async (reader) => {
        const roots = reader.roots();
        const existing: string[] = [];
        for (const root of roots) {
          if (await dirExists(root)) existing.push(root);
        }
        try {
          return { reader, roots: existing, sessions: await reader.read(), error: null };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { reader, roots: existing, sessions: [] as RawSession[], error: message };
        }
      })
    );

    for (const result of results) {
      const projected = result.sessions.map((session) => this.toCard(session, now));
      cards.push(...projected);
      sources.push({
        source: result.reader.source,
        available: result.roots.length > 0,
        roots: result.roots,
        cards: projected.length,
        error: result.error,
      });
    }

    cards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return { cards, sources, scannedAt: new Date(now).toISOString() };
  }

  private toCard(session: RawSession, now: number): SessionCard {
    const createdAt = session.createdAt || session.updatedAt || now;
    const updatedAt = session.updatedAt || createdAt;

    return {
      id: `${session.source}:${session.sessionId}`,
      sessionId: session.sessionId,
      source: session.source,
      title: session.title,
      status: deriveStatus(
        { updatedAt, explicitStatus: session.explicitStatus },
        now,
        this.activeWindowMs,
        this.idleWindowMs
      ),
      project: shortenProject(session.cwd),
      branch: session.branch,
      messageCount: session.messageCount,
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(updatedAt).toISOString(),
    };
  }
}
