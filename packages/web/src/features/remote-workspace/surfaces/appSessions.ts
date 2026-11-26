import type { SessionCard, SessionSource } from "@vibe-code/shared";
import type { Session } from "../model";

const SOURCES: SessionSource[] = ["opencode", "claude-code", "antigravity"];

/**
 * Sessions the app itself runs (remote conversations over `opencode serve`) have no PTY and no
 * file the disk scan reads, so Terminais and the 3D office never saw them. Project them as cards.
 */
export function appSessionCards(
  sessions: Session[],
  projects: { id: string; name: string }[]
): SessionCard[] {
  return sessions.flatMap((s) => {
    if (s.status !== "working" && s.status !== "review") return [];
    const source = (SOURCES as string[]).includes(s.engine)
      ? (s.engine as SessionSource)
      : "opencode";
    return [
      {
        id: `${source}:${s.id}`,
        sessionId: s.id,
        source,
        title: s.title,
        status: s.status === "working" ? "active" : "idle",
        project: projects.find((p) => p.id === s.projectId)?.name ?? "",
        branch: s.branch || null,
        messageCount: s.messages.length,
        createdAt: s.updatedAt,
        updatedAt: s.updatedAt,
      },
    ];
  });
}

/** Disk-scanned cards win over the app's own projection of the same session. */
export function mergeOpenCards(app: SessionCard[], scanned: SessionCard[]): SessionCard[] {
  const seen = new Set(scanned.map((c) => c.id));
  return [...app.filter((c) => !seen.has(c.id)), ...scanned];
}
