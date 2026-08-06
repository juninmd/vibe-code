import type { SessionSource } from "@vibe-code/shared";

/**
 * A session as read from a CLI's local store, before it is projected onto a
 * card. Timestamps are epoch milliseconds so status derivation stays cheap.
 */
export interface RawSession {
  sessionId: string;
  source: SessionSource;
  title: string;
  /** Absolute working directory the session ran in ("" when unknown). */
  cwd: string;
  branch: string | null;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  /**
   * Terminal state the CLI itself recorded, when it records one at all.
   * `null` means "derive from activity" — see `deriveStatus`.
   */
  explicitStatus: "done" | "failed" | null;
}

export interface SessionReader {
  source: SessionSource;
  /** Store directories this reader scans. May not exist on disk. */
  roots(): string[];
  read(): Promise<RawSession[]>;
}
