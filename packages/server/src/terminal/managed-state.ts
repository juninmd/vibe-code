import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Managed state must never follow a repository-provided link outside its worktree. */
export async function managedStatePath(cwd: string, name: string): Promise<string> {
  if (!/^[\w.-]+$/.test(name) || name === "." || name === "..")
    throw new Error("Invalid state filename");
  const directory = join(cwd, ".vibe-code");
  await mkdir(directory, { recursive: true });
  const folder = await lstat(directory);
  if (!folder.isDirectory() || folder.isSymbolicLink())
    throw new Error("Managed state directory must not be a symbolic link");
  const path = join(directory, name);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Managed state file must not be a symbolic link");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return path;
}

export async function readManagedState(cwd: string, name: string): Promise<string | null> {
  const path = await managedStatePath(cwd, name);
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeManagedState(cwd: string, name: string, content: string): Promise<void> {
  const path = await managedStatePath(cwd, name);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
