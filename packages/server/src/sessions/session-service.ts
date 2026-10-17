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
const DEFAULT_CACHE_TTL_MS = 60_000;

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

/** Everything a scan produced, before it is projected onto cards. */
interface RawScan {
  sessions: RawSession[];
  sources: SessionSourceStatus[];
  /** When the scan ran, so a cached response reports its real age. */
  scannedAt: number;
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
  private cache: { at: number; result: RawScan } | null = null;
  private inflight: Promise<RawScan> | null = null;

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
    const { sessions, sources, scannedAt } = await this.scanRaw(options.refresh === true);
    const now = this.now();

    let cards = sessions
      .map((session) => this.toCard(session, now))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    if (options.source) cards = cards.filter((card) => card.source === options.source);
    if (options.limit !== undefined && options.limit >= 0) cards = cards.slice(0, options.limit);

    // The scan timestamp, not the request time: a cached scan can be up to a TTL old.
    return { cards, sources, scannedAt: new Date(scannedAt).toISOString() };
  }

  /**
   * The raw session behind a card, including its working directory. Cards deliberately
   * drop the cwd; this is how a caller (opening a terminal in that directory) gets it back.
   * Uses the same short cache as `list`.
   */
  async find(source: SessionSource, sessionId: string): Promise<RawSession | null> {
    const { sessions } = await this.scanRaw(false);
    return sessions.find((s) => s.source === source && s.sessionId === sessionId) ?? null;
  }

  /** Scans every store, honouring the short cache unless `force` is set. */
  private async scanRaw(force: boolean): Promise<RawScan> {
    const now = this.now();
    if (!force && this.cache && now - this.cache.at < this.cacheTtlMs) return this.cache.result;
    if (this.inflight) return this.inflight;

    this.inflight = this.scanNow()
      .then((result) => {
        this.cache = { at: this.now(), result };
        return result;
      })
      .finally(() => {
        this.inflight = null;
      });

    return this.inflight;
  }

  private async scanNow(): Promise<RawScan> {
    const sessions: RawSession[] = [];
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
      sessions.push(...result.sessions);
      sources.push({
        source: result.reader.source,
        available: result.roots.length > 0,
        roots: result.roots,
        cards: result.sessions.length,
        error: result.error,
      });
    }

    return { sessions, sources, scannedAt: this.now() };
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
