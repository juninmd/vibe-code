import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Db } from "../../db";
import * as telegram from "../../notifications/telegram";
import { ConflictResolver } from "../conflict-resolver";
import type { Orchestrator } from "../orchestrator";

describe("ConflictResolver", () => {
  let db: any;
  let orchestrator: any;
  let resolver: ConflictResolver;

  beforeEach(() => {
    db = {
      tasks: {
        list: mock().mockReturnValue([]),
        listChildren: mock().mockReturnValue([]),
        create: mock().mockReturnValue({ id: "new-task-id" }),
        updateField: mock(),
        getById: mock(),
      },
      settings: {
        get: mock().mockReturnValue("test-token"),
      },
      repos: {
        getById: mock().mockReturnValue({ id: "repo-1", name: "test-repo", defaultBranch: "main" }),
      },
    };
    orchestrator = {
      launch: mock().mockResolvedValue(undefined),
    };
    resolver = new ConflictResolver(db as unknown as Db, orchestrator as unknown as Orchestrator);
  });

  afterEach(() => {
    mock.restore();
  });

  it("should do nothing if check interval has not elapsed", async () => {
    resolver["lastCheckAt"] = Date.now();
    await resolver.check();
    expect(db.tasks.list).not.toHaveBeenCalled();
  });

  it("should do nothing if there are no candidates", async () => {
    resolver["lastCheckAt"] = 0;
    await resolver.check();
    expect(db.tasks.list).toHaveBeenCalled();
    expect(db.settings.get).not.toHaveBeenCalled();
  });

  it("should warn if no github token is available", async () => {
    db.tasks.list.mockImplementation((_: any, status: string) => {
      if (status === "review") return [{ id: "task-1", prUrl: "https://github.com/a/b/pull/1" }];
      return [];
    });
    db.settings.get.mockReturnValue(undefined);
    const originalEnv = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    await resolver.check();

    expect(warnSpy).toHaveBeenCalledWith(
      "[conflict-resolver] No GitHub token — skipping PR conflict check"
    );

    process.env.GITHUB_TOKEN = originalEnv;
  });

  it("should create a conflict resolution task if a PR has conflicts", async () => {
    db.tasks.list.mockImplementation((_: any, status: string) => {
      if (status === "review")
        return [
          {
            id: "task-1",
            repoId: "repo-1",
            title: "Test task",
            prUrl: "https://github.com/owner/repo/pull/123",
            branchName: "feat/test",
          },
        ];
      return [];
    });

    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ mergeable: false }), { status: 200 })
    );

    const telegramMock = { isConfigured: () => true, send: mock().mockResolvedValue(undefined) };
    spyOn(telegram, "createTelegramNotifier").mockReturnValue(telegramMock as any);

    await resolver.check();

    expect(fetchSpy).toHaveBeenCalled();
    expect(db.tasks.create).toHaveBeenCalled();
    expect(db.tasks.updateField).toHaveBeenCalledWith("new-task-id", "branch_name", "feat/test");
    expect(telegramMock.send).toHaveBeenCalled();
    expect(orchestrator.launch).toHaveBeenCalled();
  });

  it("should not create a conflict task if one already exists", async () => {
    db.tasks.list.mockImplementation((_: any, status: string) => {
      if (status === "review")
        return [{ id: "task-1", prUrl: "https://github.com/owner/repo/pull/123" }];
      return [];
    });
    db.tasks.listChildren.mockReturnValue([
      { id: "task-2", tags: ["conflict-resolution"], status: "in_progress" },
    ]);

    const fetchSpy = spyOn(globalThis, "fetch");

    await resolver.check();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.tasks.create).not.toHaveBeenCalled();
  });

  it("notifyConflictResolved should notify telegram", async () => {
    const telegramMock = { isConfigured: () => true, send: mock().mockResolvedValue(undefined) };
    spyOn(telegram, "createTelegramNotifier").mockReturnValue(telegramMock as any);

    await resolver.notifyConflictResolved({
      title: "test task",
      repoId: "repo-1",
      branchName: "test",
    } as any);

    expect(telegramMock.send).toHaveBeenCalled();
  });
});
