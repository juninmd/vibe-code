import { describe, expect, it } from "vitest";
import type { Session } from "../model";
import { appSessionCards, mergeOpenCards } from "./appSessions";

const session = (over: Partial<Session>): Session => ({
  id: "t1",
  projectId: "p1",
  title: "Limpar o repositório",
  description: "",
  status: "working",
  engine: "opencode",
  model: "",
  branch: "main",
  updatedAt: "2026-11-26T00:00:00.000Z",
  messages: [],
  changes: [],
  ...over,
});
const projects = [{ id: "p1", name: "demo-app" }];

describe("appSessionCards", () => {
  it("turns a running app session into an active card", () => {
    const [card] = appSessionCards([session({})], projects);
    expect(card).toMatchObject({
      id: "opencode:t1",
      title: "Limpar o repositório",
      status: "active",
      project: "demo-app",
    });
  });
  it("shows a session waiting for the operator as idle and hides idle and failed ones", () => {
    const cards = appSessionCards(
      [
        session({ id: "a", status: "review" }),
        session({ id: "b", status: "waiting" }),
        session({ id: "c", status: "failed" }),
      ],
      projects
    );
    expect(cards.map((c) => [c.sessionId, c.status])).toEqual([["a", "idle"]]);
  });
  it("falls back to opencode for engines the board does not know", () => {
    expect(appSessionCards([session({ engine: "gemini" })], projects)[0].source).toBe("opencode");
  });
});

describe("mergeOpenCards", () => {
  it("does not duplicate a session the disk scan already found", () => {
    const [app] = appSessionCards([session({})], projects);
    expect(mergeOpenCards([app], [{ ...app, messageCount: 9 }])).toHaveLength(1);
  });
});
