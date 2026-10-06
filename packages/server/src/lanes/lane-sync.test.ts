import { beforeEach, describe, expect, it } from "bun:test";
import type { RepositoryIssue, Task, WsServerMessage } from "@vibe-code/shared";
import { createDb } from "../db";
import type { ProviderRegistry } from "../git/providers/registry";
import type { GitProviderAdapter } from "../git/providers/types";
import type { BroadcastHub } from "../ws/broadcast";
import { decideLaneSync, LaneConfigError, type LaneFacts, LaneSyncService } from "./lane-sync";

const facts = (over: Partial<LaneFacts>): LaneFacts => ({
  local: "backlog",
  synced: "backlog",
  remote: "backlog",
  busy: false,
  preferLocal: false,
  ...over,
});

describe("decideLaneSync", () => {
  it("does nothing when everything agrees", () => {
    expect(decideLaneSync(facts({}))).toEqual({ kind: "none" });
  });

  it("leaves cards outside the lanes alone", () => {
    expect(decideLaneSync(facts({ local: null, remote: "done" }))).toEqual({ kind: "none" });
  });

  it("pushes a card the operator moved", () => {
    expect(decideLaneSync(facts({ local: "review" }))).toEqual({ kind: "push", lane: "review" });
  });

  it("pulls an issue somebody relabelled", () => {
    expect(decideLaneSync(facts({ remote: "in_progress" }))).toEqual({
      kind: "pull",
      lane: "in_progress",
    });
  });

  it("lets the issue win when both moved", () => {
    expect(decideLaneSync(facts({ local: "review", remote: "done" }))).toEqual({
      kind: "pull",
      lane: "done",
    });
  });

  it("lets the card win when the operator just moved it or an agent is working on it", () => {
    expect(decideLaneSync(facts({ local: "review", remote: "done", preferLocal: true }))).toEqual({
      kind: "push",
      lane: "review",
    });
    expect(decideLaneSync(facts({ local: "in_progress", remote: "done", busy: true }))).toEqual({
      kind: "push",
      lane: "in_progress",
    });
  });

  it("never yanks a card away from a working agent because of a remote move", () => {
    expect(decideLaneSync(facts({ local: "backlog", remote: "done", busy: true }))).toEqual({
      kind: "none",
    });
  });

  it("settles when both sides moved to the same lane", () => {
    expect(decideLaneSync(facts({ local: "review", remote: "review" }))).toEqual({
      kind: "settle",
      lane: "review",
    });
  });

  it("restores the lane label when someone strips it", () => {
    expect(decideLaneSync(facts({ remote: null }))).toEqual({ kind: "push", lane: "backlog" });
  });

  describe("first contact", () => {
    it("adopts the issue's lane: what is in the issue is in the app", () => {
      expect(decideLaneSync(facts({ synced: null, local: "backlog", remote: "review" }))).toEqual({
        kind: "pull",
        lane: "review",
      });
    });

    it("labels an issue that has no lane yet", () => {
      expect(decideLaneSync(facts({ synced: null, local: "review", remote: null }))).toEqual({
        kind: "push",
        lane: "review",
      });
    });

    it("keeps a working agent's lane and tells the issue", () => {
      expect(
        decideLaneSync(facts({ synced: null, local: "in_progress", remote: "backlog", busy: true }))
      ).toEqual({ kind: "push", lane: "in_progress" });
    });

    it("just remembers an agreement", () => {
      expect(decideLaneSync(facts({ synced: null, local: "done", remote: "done" }))).toEqual({
        kind: "settle",
        lane: "done",
      });
    });
  });
});

// ─── Service ────────────────────────────────────────────────────────────────

interface FakeIssue extends RepositoryIssue {}

function issue(number: number, labels: string[], over: Partial<FakeIssue> = {}): FakeIssue {
  return {
    id: String(number),
    number,
    title: `Issue ${number}`,
    body: `Body ${number}`,
    state: "open",
    labels,
    assignee: null,
    assignees: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    url: `https://github.com/o/r/issues/${number}`,
    ...over,
  };
}

function setup(issues: FakeIssue[], opts: { token?: boolean } = {}) {
  const db = createDb(":memory:");
  const repo = db.repos.create({ url: "https://github.com/o/r.git" });
  const calls = {
    labels: [] as Array<{ number: number; add: string[]; remove: string[] }>,
    ensured: [] as string[][],
    listed: 0,
  };
  const adapter = {
    name: "github",
    listIssues: async () => {
      calls.listed++;
      return issues;
    },
    updateIssueLabels: async (
      _token: string,
      _url: string,
      number: number,
      change: { add: string[]; remove: string[] }
    ) => {
      calls.labels.push({ number, ...change });
      const target = issues.find((entry) => entry.number === number);
      if (target) {
        target.labels = [...target.labels.filter((l) => !change.remove.includes(l)), ...change.add];
      }
    },
    ensureLabels: async (_token: string, _url: string, labels: Array<{ name: string }>) => {
      calls.ensured.push(labels.map((label) => label.name));
    },
  } as unknown as GitProviderAdapter;
  const providers = {
    detectProvider: () => "github",
    resolve: () => (opts.token === false ? null : { adapter, token: "t", provider: "github" }),
  } as unknown as ProviderRegistry;
  const messages: WsServerMessage[] = [];
  const hub = { broadcastAll: (m: WsServerMessage) => messages.push(m) } as unknown as BroadcastHub;
  let busy = new Set<string>();
  const lanes = new LaneSyncService({
    db,
    providers,
    hub,
    isBusy: (id) => busy.has(id),
    debounceMs: 5,
    pollMs: 1_000_000,
  });
  const link = (number: number, over: Partial<Parameters<typeof db.tasks.create>[0]> = {}) =>
    db.tasks.create({
      title: `Task ${number}`,
      repoId: repo.id,
      issueUrl: `https://github.com/o/r/issues/${number}`,
      ...over,
    });
  return {
    db,
    repo,
    calls,
    lanes,
    messages,
    issues,
    link,
    setBusy: (id: string) => (busy = new Set([id])),
  };
}

const get = (db: ReturnType<typeof createDb>, id: string) => db.tasks.getById(id) as Task;

describe("LaneSyncService", () => {
  let enabled: ReturnType<typeof setup>;

  beforeEach(() => {
    enabled = setup([]);
  });

  it("is off until the operator turns it on, and never calls the provider while off", async () => {
    const { lanes, calls } = enabled;
    expect(lanes.settings().enabled).toBe(false);
    lanes.nudge({ id: "x", repoId: "r", issueUrl: "u", status: "review" } as unknown as Task);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.listed).toBe(0);
  });

  it("labels issues for linked cards on first contact and creates the label set", async () => {
    const { lanes, link, issues, calls, db } = setup([issue(1, ["bug"])]);
    const task = link(1, { status: "review" });
    lanes.update({ enabled: true });
    await lanes.syncAll();

    expect(calls.labels).toEqual([{ number: 1, add: ["status:review"], remove: [] }]);
    expect(issues[0].labels).toContain("status:review");
    expect(calls.ensured[0]).toEqual([
      "status:todo",
      "status:in-progress",
      "status:blocked",
      "status:review",
      "status:done",
    ]);
    expect(get(db, task.id).issueLane).toBe("review");
  });

  it("moves the card when somebody relabels the issue", async () => {
    const { lanes, link, issues, db, messages } = setup([issue(1, ["status:todo"])]);
    const task = link(1);
    lanes.update({ enabled: true });
    await lanes.syncAll();
    expect(get(db, task.id).status).toBe("backlog");

    issues[0].labels = ["status:in-progress"];
    const status = await lanes.syncAll();

    expect(get(db, task.id).status).toBe("in_progress");
    expect(get(db, task.id).issueLane).toBe("in_progress");
    expect(status.repos[0].pulled).toBe(1);
    expect(messages.some((m) => m.type === "task_updated" && m.task.id === task.id)).toBe(true);
  });

  it("relabels the issue when the card is dragged, replacing the old lane", async () => {
    const { lanes, link, issues, db, calls } = setup([issue(1, ["status:todo", "bug"])]);
    const task = link(1);
    lanes.update({ enabled: true });
    await lanes.syncAll();
    calls.labels.length = 0;

    db.tasks.update(task.id, { status: "review" });
    await lanes.syncAll();

    expect(calls.labels).toEqual([{ number: 1, add: ["status:review"], remove: ["status:todo"] }]);
    expect(issues[0].labels.sort()).toEqual(["bug", "status:review"]);
  });

  it("syncs a drag by itself shortly after, without waiting for the poll", async () => {
    const { lanes, link, db, calls } = setup([issue(1, ["status:todo"])]);
    const task = link(1);
    lanes.update({ enabled: true });
    await lanes.syncAll();
    lanes.start();
    calls.labels.length = 0;

    db.tasks.update(task.id, { status: "done" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    lanes.stop();

    expect(calls.labels.map((entry) => entry.add)).toEqual([["status:done"]]);
    expect(get(db, task.id).issueLane).toBe("done");
  });

  it("does not echo its own writes back to the provider", async () => {
    const { lanes, link, issues, db, calls } = setup([issue(1, ["status:todo"])]);
    link(1);
    lanes.update({ enabled: true });
    await lanes.syncAll();
    lanes.start();
    issues[0].labels = ["status:review"];
    await lanes.syncAll();
    await new Promise((resolve) => setTimeout(resolve, 40));
    lanes.stop();

    expect(calls.labels).toEqual([]);
    expect(db.tasks.list()[0].status).toBe("review");
  });

  it("does not move a card an agent is working on because of a remote relabel", async () => {
    const { lanes, link, issues, db, setBusy } = setup([issue(1, ["status:in-progress"])]);
    const task = link(1, { status: "in_progress" });
    lanes.update({ enabled: true });
    await lanes.syncAll();
    setBusy(task.id);

    issues[0].labels = ["status:done"];
    await lanes.syncAll();

    expect(get(db, task.id).status).toBe("in_progress");
  });

  it("imports open issues that carry a lane label, as cards no autopilot will run", async () => {
    const { lanes, db, messages } = setup([
      issue(5, ["status:review", "bug"]),
      issue(6, ["bug"]),
      issue(7, ["status:done"], { state: "closed" }),
    ]);
    lanes.update({ enabled: true });
    await lanes.syncAll();

    const tasks = db.tasks.list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Issue 5");
    expect(tasks[0].status).toBe("review");
    expect(tasks[0].issueLane).toBe("review");
    expect(tasks[0].tags).toEqual(["manual", "bug"]);
    expect(tasks[0].description).toContain("Original issue: https://github.com/o/r/issues/5");
    expect(messages.some((m) => m.type === "task_created")).toBe(true);

    await lanes.syncAll();
    expect(db.tasks.list()).toHaveLength(1);
  });

  it("keeps a deleted card off the board and takes its issue off the lanes", async () => {
    const { lanes, link, issues, db, calls } = setup([issue(1, ["status:review"])]);
    const task = link(1, { status: "review" });
    lanes.update({ enabled: true });
    await lanes.syncAll();
    calls.labels.length = 0;

    db.tasks.remove(task.id);
    await lanes.forget(task);
    await lanes.syncAll();

    expect(db.tasks.list()).toHaveLength(0);
    expect(calls.labels[0].remove).toContain("status:review");
    expect(issues[0].labels).not.toContain("status:review");
  });

  it("uses custom label names and reports them back", async () => {
    const { lanes, link, issues, db } = setup([issue(1, ["QA"])]);
    const task = link(1);
    const saved = lanes.update({ enabled: true, labels: { review: "QA" } });
    expect(saved.overrides).toEqual({ review: "QA" });
    await lanes.syncAll();
    expect(get(db, task.id).status).toBe("review");
    expect(issues[0].labels).toEqual(["QA"]);
  });

  it("rejects clashing label names without saving anything", () => {
    const { lanes } = enabled;
    expect(() => lanes.update({ labels: { review: "x", done: "X" } })).toThrow(LaneConfigError);
    expect(lanes.settings().overrides).toEqual({});
  });

  it("asks for a token instead of failing silently", async () => {
    const { lanes, link } = setup([], { token: false });
    link(1);
    lanes.update({ enabled: true });
    const status = await lanes.syncAll();
    expect(status.repos[0].ok).toBe(false);
    expect(status.repos[0].error).toContain("token");
  });

  it("pauses a failing repository instead of hammering the provider", async () => {
    const env = setup([issue(1, [])]);
    env.link(1);
    let calls = 0;
    const adapter = {
      listIssues: async () => {
        calls++;
        throw new Error("GitHub API error: 403");
      },
    };
    const lanes = new LaneSyncService({
      db: env.db,
      providers: {
        detectProvider: () => "github",
        resolve: () => ({ adapter, token: "t", provider: "github" }),
      } as unknown as ProviderRegistry,
      hub: { broadcastAll: () => {} } as unknown as BroadcastHub,
      isBusy: () => false,
    });
    lanes.update({ enabled: true });
    await lanes.syncAll();
    const status = await lanes.syncAll();
    expect(calls).toBe(1);
    expect(status.repos[0].error).toContain("Paused");
  });
});
