import { expect, test } from "bun:test";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readManagedState, writeManagedState } from "./managed-state";
import { prepareOpenCodeSession } from "./model-catalog";

test("rejects a repository-provided managed directory link before calling OpenCode", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibe-state-links-"));
  const cwd = join(root, "workspace");
  const outside = join(root, "outside");
  try {
    await mkdir(cwd);
    await mkdir(outside);
    await writeFile(join(outside, "opencode-session.json"), "original");
    await symlink(
      outside,
      join(cwd, ".vibe-code"),
      process.platform === "win32" ? "junction" : "dir"
    );
    let called = false;
    await expect(
      prepareOpenCodeSession(cwd, "Task", undefined, undefined, async () => {
        called = true;
        return "{}";
      })
    ).rejects.toThrow("symbolic link");
    expect(called).toBe(false);
    expect(await readFile(join(outside, "opencode-session.json"), "utf8")).toBe("original");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("atomic state replacement preserves the target of an existing hard link", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibe-state-atomic-"));
  try {
    await mkdir(join(root, ".vibe-code"));
    await writeFile(join(root, "outside.json"), "original");
    await link(join(root, "outside.json"), join(root, ".vibe-code/opencode-session.json"));
    await writeManagedState(root, "opencode-session.json", '{"id":"owned"}');
    expect(await readManagedState(root, "opencode-session.json")).toBe('{"id":"owned"}');
    expect(await readFile(join(root, "outside.json"), "utf8")).toBe("original");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("rejects a symbolic marker file", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibe-state-marker-"));
  try {
    await mkdir(join(root, ".vibe-code"));
    await writeFile(join(root, "outside.json"), "original");
    await symlink(join(root, "outside.json"), join(root, ".vibe-code/opencode-session.json"));
    await expect(writeManagedState(root, "opencode-session.json", "changed")).rejects.toThrow(
      "symbolic link"
    );
    expect(await readFile(join(root, "outside.json"), "utf8")).toBe("original");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
