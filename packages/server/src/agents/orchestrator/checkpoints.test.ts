import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointConflict, captureCheckpoint, restoreCheckpoint } from "./checkpoints";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function sh(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text());
  return out.trim();
}

async function repo() {
  const dir = await mkdtemp(join(tmpdir(), "vibe-ckpt-"));
  roots.push(dir);
  await sh(dir, "init", "-q");
  await sh(dir, "config", "user.email", "t@t.t");
  await sh(dir, "config", "user.name", "t");
  await writeFile(join(dir, ".gitignore"), "node_modules\n");
  await writeFile(join(dir, "a.txt"), "original\n");
  await sh(dir, "add", ".");
  await sh(dir, "commit", "-qm", "init");
  return dir;
}

describe("turn checkpoints", () => {
  it("undo a turn's edits, new files and staged changes, keeping uncommitted work from before it", async () => {
    const dir = await repo();
    await writeFile(join(dir, "draft.txt"), "before the turn\n");
    const checkpoint = await captureCheckpoint(dir);
    expect(await sh(dir, "status", "--porcelain")).toBe("?? draft.txt");

    await writeFile(join(dir, "a.txt"), "edited by the agent\n");
    await writeFile(join(dir, "new.ts"), "export {};\n");
    await writeFile(join(dir, "draft.txt"), "changed\n");
    await sh(dir, "add", "new.ts");
    await restoreCheckpoint(dir, checkpoint);

    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("original\n");
    expect(await readFile(join(dir, "draft.txt"), "utf8")).toBe("before the turn\n");
    expect(existsSync(join(dir, "new.ts"))).toBe(false);
    expect(await sh(dir, "status", "--porcelain")).toBe("?? draft.txt");
  });

  it("never touches ignored files", async () => {
    const dir = await repo();
    const checkpoint = await captureCheckpoint(dir);
    await writeFile(join(dir, "node_modules"), "deps");
    await restoreCheckpoint(dir, checkpoint);
    expect(existsSync(join(dir, "node_modules"))).toBe(true);
  });

  it("refuses to rewind past a commit instead of losing it", async () => {
    const dir = await repo();
    const checkpoint = await captureCheckpoint(dir);
    await writeFile(join(dir, "a.txt"), "committed later\n");
    await sh(dir, "commit", "-qam", "later");
    await expect(restoreCheckpoint(dir, checkpoint)).rejects.toBeInstanceOf(CheckpointConflict);
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("committed later\n");
  });

  it("rejects anything that is not a commit id", async () => {
    const dir = await repo();
    await expect(restoreCheckpoint(dir, "HEAD; rm -rf /")).rejects.toThrow("Invalid checkpoint");
  });
});
