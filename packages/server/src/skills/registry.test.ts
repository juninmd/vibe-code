import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db";
import { SkillRegistryService } from "./registry";

describe("SkillRegistryService", () => {
  let baseDir: string;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "vibe-registry-"));
    fetchSpy = spyOn(global, "fetch").mockImplementation((async () => {
      return new Response(
        `---\nname: governed-skill\nversion: 1.2.0\ncompatibility: >=0.1.0\n---\n# Skill`,
        { status: 200 }
      );
    }) as unknown as typeof fetch);
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await rm(baseDir, { recursive: true, force: true });
  });

  test("installs assets as pending review and activates them after approval", async () => {
    const registry = new SkillRegistryService(baseDir);
    await registry.init();

    const installed = await registry.installFromGitHub({
      repoPath: "owner/repo/skills/governed-skill",
      ref: "stable",
    });
    expect(installed.reviewStatus).toBe("pending_review");

    const approved = await registry.approve(installed.id);
    expect(approved.reviewStatus).toBe("active");

    const entries = await registry.listInstalled();
    expect(entries.find((entry) => entry.id === installed.id)?.reviewStatus).toBe("active");
  });

  test("builds hygiene reports from registry, memories, and failed dependencies", async () => {
    const registry = new SkillRegistryService(baseDir);
    await registry.init();
    await registry.installFromGitHub({ repoPath: "owner/repo/skills/governed-skill" });

    const db = createDb(":memory:");
    const repo = db.repos.create({ url: "https://github.com/test/repo.git" });
    db.repos.updateStatus(repo.id, "ready", "/tmp/repo.git");
    const dependency = db.tasks.create({ title: "Dependency", repoId: repo.id });
    const dependent = db.tasks.create({
      title: "Dependent",
      repoId: repo.id,
      dependsOn: [dependency.id],
    });
    db.tasks.update(dependency.id, { status: "failed" });
    db.memories.create({
      taskId: dependent.id,
      scope: "task",
      content: "needs compaction",
      needsCompaction: true,
    });

    const report = await registry.generateHygieneReport(db);
    expect(report.pendingRegistryReviews).toBe(1);
    expect(report.memoriesNeedingCompaction).toBe(1);
    expect(report.blockedByFailedDependencies).toBe(1);
  });
});
