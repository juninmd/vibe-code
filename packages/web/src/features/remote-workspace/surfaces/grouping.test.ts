import { describe, expect, it } from "vitest";
import type { Project, Session } from "../model";
import { groupSessions } from "./grouping";

const session = (id: string, projectId: string, status: Session["status"], engine: string) =>
  ({ id, projectId, status, engine }) as Session;
const projects = [{ id: "p1", name: "api" }] as Project[];
const sessions = [
  session("1", "p1", "working", "opencode"),
  session("2", "gone", "review", "claude-code"),
  session("3", "p1", "review", "opencode"),
];

describe("groupSessions", () => {
  it("keeps one unlabelled group when grouping is off", () => {
    expect(groupSessions(sessions, "none", projects)).toEqual([
      { key: "all", label: "", sessions },
    ]);
  });

  it("names project groups and flags sessions whose project is gone", () => {
    const groups = groupSessions(sessions, "project", projects);
    expect(groups.map((g) => [g.label, g.sessions.map((s) => s.id)])).toEqual([
      ["api", ["1", "3"]],
      ["Sem projeto", ["2"]],
    ]);
  });

  it("uses the operator-facing status label", () => {
    const groups = groupSessions(sessions, "status", projects);
    expect(groups.map((g) => g.label)).toEqual(["Em execução", "Em revisão"]);
  });
});
