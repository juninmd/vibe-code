import { describe, expect, it } from "vitest";
import { attentionChannel, attentionMessage, finishedSessions, newlyAwaiting } from "./attention";

describe("finishedSessions", () => {
  it("reports only sessions that left working since the last snapshot", () => {
    const previous = new Map([
      ["a", "working" as const],
      ["b", "working" as const],
      ["c", "waiting" as const],
    ]);
    const now = [
      { id: "a", status: "review" as const },
      { id: "b", status: "working" as const },
      { id: "c", status: "failed" as const },
      { id: "d", status: "waiting" as const },
    ];
    expect(finishedSessions(previous, now)).toEqual([{ sessionId: "a", status: "review" }]);
  });

  it("stays quiet on the first load, so reopening the app does not notify old runs", () => {
    expect(finishedSessions(new Map(), [{ id: "a", status: "waiting" }])).toEqual([]);
  });
});

describe("attentionChannel", () => {
  const base = {
    sessionId: "a",
    viewingSessionId: "a",
    visible: true,
    focused: true,
    systemAllowed: true,
  };

  it("does nothing while you are looking at the session", () => {
    expect(attentionChannel(base)).toBe("none");
  });

  it("shows an in-app notice when the app is in front on another session", () => {
    expect(attentionChannel({ ...base, viewingSessionId: "b" })).toBe("in-app");
  });

  it("uses a system notification when the app is hidden or unfocused", () => {
    expect(attentionChannel({ ...base, visible: false })).toBe("system");
    expect(attentionChannel({ ...base, focused: false })).toBe("system");
  });

  it("falls back to in-app when the browser does not allow notifications", () => {
    expect(attentionChannel({ ...base, visible: false, systemAllowed: false })).toBe("in-app");
  });
});

describe("attentionMessage", () => {
  it("says what the user has to do next", () => {
    expect(attentionMessage("failed")).toBe("precisa de atenção");
    expect(attentionMessage("review")).toContain("revisão");
  });
});

describe("newlyAwaiting", () => {
  it("alerts once when a session starts waiting for approval, not while it keeps waiting", () => {
    expect(newlyAwaiting(new Set(), new Set(["a"]))).toEqual([
      { sessionId: "a", status: "approval" },
    ]);
    expect(newlyAwaiting(new Set(["a"]), new Set(["a", "b"]))).toEqual([
      { sessionId: "b", status: "approval" },
    ]);
    expect(newlyAwaiting(new Set(["a"]), new Set())).toEqual([]);
    expect(attentionMessage("approval")).toContain("aprovação");
  });
});
