import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";
import { createInterface } from "node:readline";

/** Expands a leading `~` to the current user's home directory. */
export function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

export async function dirExists(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

export async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

export async function safeReadJson<T = unknown>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** Modification time in epoch ms, or 0 when the file is unreadable. */
export async function safeMtime(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

/** Hard cap so a pathological transcript cannot stall a board refresh. */
const MAX_LINES_PER_FILE = 200_000;

/**
 * Streams a file line by line. Transcripts reach hundreds of MB, and callers
 * only keep a handful of derived scalars, so nothing is buffered here.
 */
export async function* readLines(file: string): AsyncGenerator<string> {
  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(file, { encoding: "utf-8" });
  } catch {
    return;
  }
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  let count = 0;
  try {
    for await (const line of rl) {
      if (++count > MAX_LINES_PER_FILE) break;
      yield line;
    }
  } catch {
    // truncated / unreadable file — keep whatever was parsed so far
  } finally {
    rl.close();
    stream.destroy();
  }
}

/** Recursively collects directories whose basename matches `name`. */
export async function findDirsNamed(root: string, name: string, maxDepth = 6): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (entry.name === name) {
        found.push(full);
        continue; // don't descend into a match
      }
      await walk(full, depth + 1);
    }
  };
  await walk(root, 0);
  return found;
}

const TITLE_MAX = 120;

/** First non-empty line of `text`, collapsed and clipped to card width. */
export function toTitle(text: string, fallback: string): string {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return fallback;
  const collapsed = line.replace(/\s+/g, " ");
  return collapsed.length > TITLE_MAX ? `${collapsed.slice(0, TITLE_MAX - 1)}…` : collapsed;
}

/**
 * Display name for a session's working directory. Cards show the project, not
 * the machine's directory layout, so only the last segment survives.
 */
export function shortenProject(cwd: string): string {
  if (!cwd) return "unknown";
  const normalized = cwd.replace(/[\\/]+$/, "");
  const name = basename(normalized) || normalized.split(sep).pop() || normalized;
  return name || "unknown";
}

/** Accepts epoch ms, epoch seconds or an ISO string; returns epoch ms (0 = unknown). */
export function toEpochMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Values below this threshold are seconds, not milliseconds (year ~2001).
    return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== "") return toEpochMs(numeric);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

/** Reads the first defined value among `keys` from a loosely-typed record. */
export function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}
