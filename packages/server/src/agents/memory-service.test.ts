import { describe, expect, it } from "bun:test";
import { createDb } from "../db";
import { MemoryService } from "./memory-service";

function makeDb() {
  return createDb(":memory:");
}

function seedTaskGraph() {
  const db = makeDb();
  const repo = db.repos.create({ url: "https://github.com/test/repo.git" });
  db.repos.updateStatus(repo.id, "ready", "/tmp/repo.git");
  const parent = db.tasks.create({ title: "Parent", repoId: repo.id });
  const child = db.tasks.create({ title: "Child", repoId: repo.id, parentTaskId: parent.id });
  return { db, parent, child };
}

describe("MemoryService", () => {
  it("ranks current task memory ahead of ancestor memory and reflection artifacts", async () => {
    const { db, parent, child } = seedTaskGraph();
    const service = new MemoryService(db);

    await service.upsertMemory(parent.id, "shared", "Parent shared guidance");
    await service.upsertMemory(child.id, "task", "Current task troubleshooting notes");
    db.artifacts.upsert({
      taskId: child.id,
      kind: "reflection",
      title: "Run reflection",
      uri: "run:1:reflection",
      metadata: { reflection: "Prefer deterministic validation before review." },
    });

    const context = await service.getRelevantContext(child);

    expect(context.entries[0]?.content).toContain("Current task troubleshooting notes");
    expect(context.sharedMemory).toContain("Parent shared guidance");
    expect(context.taskMemory).toContain("Prefer deterministic validation before review.");
  });

  it("compacts oversized memories when appending run summaries", async () => {
    const { db, child } = seedTaskGraph();
    const service = new MemoryService(db);
    const manyLines = Array.from({ length: 180 }, (_, index) => `line-${index}`).join("\n");
    await service.upsertMemory(child.id, "task", manyLines);

    const result = await service.appendRunSummary(child, {
      runId: "run-1",
      finalStatus: "completed",
      qualityScore: 91,
      validatorAttempts: 1,
      reviewBlockers: 0,
      reviewWarnings: 1,
      validationSummary: "all checks passed",
      validationCommands: ["bun test"],
      branch: "feat/test",
      prCreated: true,
      reflection: "Keep the validation harness deterministic.",
    });

    expect(result.taskMemory.content).toContain("## Compacted Memory");
    expect(result.taskMemory.content).toContain("Keep the validation harness deterministic.");
  });
});
