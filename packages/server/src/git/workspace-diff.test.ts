import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitService } from "./git-service";

test("reviews committed, dirty and new files without staging or committing the operator's workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibe-workspace-diff-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  try {
    git("init", "--initial-branch=main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    await writeFile(join(root, "tracked.md"), "original\n");
    git("add", "tracked.md");
    git("commit", "-m", "seed");
    git("checkout", "-b", "work");
    await writeFile(join(root, "committed.md"), "committed\n");
    git("add", "committed.md");
    git("commit", "-m", "change");
    await writeFile(join(root, "tracked.md"), "edited while idle\n");
    await writeFile(join(root, "new.md"), "new file awaiting review\n");
    await writeFile(join(root, "binary.bin"), new Uint8Array([0, 1, 2]));
    const service = new GitService(join(root, "data"));
    const before = git("status", "--porcelain");
    const opts = { cwd: root, workingTree: true };
    const files = await service.diffSummary("main", "HEAD", opts);
    expect(files.map((file) => file.path).sort()).toEqual([
      "binary.bin",
      "committed.md",
      "new.md",
      "tracked.md",
    ]);
    expect(await service.diffFileContent("main", "HEAD", "tracked.md", opts)).toContain(
      "+edited while idle"
    );
    expect(await service.diffFileContent("main", "HEAD", "new.md", opts)).toContain(
      "+new file awaiting review"
    );
    expect(await service.diffFileContent("main", "HEAD", "binary.bin", opts)).toContain("binário");
    expect(git("status", "--porcelain")).toBe(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
