import type { SessionCard } from "@vibe-code/shared";

const now = new Date().toISOString();

const card = (
  n: number,
  source: SessionCard["source"],
  title: string,
  status: SessionCard["status"],
  project: string
): SessionCard => ({
  id: `${source}:demo-${n}`,
  sessionId: `demo-${n}`,
  source,
  title,
  status,
  project,
  branch: "main",
  messageCount: 12 + n * 7,
  createdAt: now,
  updatedAt: now,
});

/** Sample sessions for previews (`?office-demo=1`) when no CLI session is open. */
export const DEMO_SESSIONS: SessionCard[] = [
  card(1, "claude-code", "Refactor auth middleware", "active", "vibe-code"),
  card(2, "opencode", "Fix flaky WebSocket tests", "active", "vibe-code"),
  card(3, "antigravity", "Add 3D office mode", "active", "vibe-kanban"),
  card(4, "claude-code", "Review pending PR #442", "idle", "vibe-kanban"),
  card(5, "opencode", "Migrate SQLite schema", "idle", "vibe-code"),
];
