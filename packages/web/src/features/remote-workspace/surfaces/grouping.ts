import { type Project, type Session, STATUS } from "../model";

export type GroupBy = "none" | "project" | "status" | "engine";

export const GROUP_LABELS: Record<GroupBy, string> = {
  none: "Sem agrupamento",
  project: "Projeto",
  status: "Estado",
  engine: "Engine",
};

/** Splits sessions into labelled groups, keeping the incoming order inside each group. */
export function groupSessions(
  sessions: Session[],
  by: GroupBy,
  projects: Project[]
): { key: string; label: string; sessions: Session[] }[] {
  if (by === "none") return [{ key: "all", label: "", sessions }];
  const groups = new Map<string, { key: string; label: string; sessions: Session[] }>();
  for (const session of sessions) {
    const key =
      by === "project" ? session.projectId : by === "status" ? session.status : session.engine;
    const label =
      by === "project"
        ? (projects.find((p) => p.id === key)?.name ?? "Sem projeto")
        : by === "status"
          ? STATUS[session.status]
          : key || "Sem engine";
    const group = groups.get(key) ?? { key, label, sessions: [] };
    group.sessions.push(session);
    groups.set(key, group);
  }
  return [...groups.values()];
}
