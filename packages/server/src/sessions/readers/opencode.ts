import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RawSession, SessionReader } from "../types";
import {
  dirExists,
  expandHome,
  findDirsNamed,
  safeReaddir,
  safeReadJson,
  toEpochMs,
  toTitle,
} from "../util";

/**
 * OpenCode stores one JSON file per session under a `storage/session/`
 * directory. The exact prefix moved between releases (`storage/session/...`
 * vs `project/<hash>/storage/session/...`), so the reader locates any
 * directory named `session` under the data root instead of hardcoding a path.
 */
const DEFAULT_ROOTS = ["~/.local/share/opencode"];

interface OpencodeSession {
  id?: string;
  parentID?: string | null;
  title?: string;
  directory?: string;
  time?: { created?: number; updated?: number; completed?: number };
}

/** Collects `*.json` files under `dir`, a couple of levels deep. */
async function collectJsonFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectJsonFiles(full, depth + 1)));
    else if (entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}

/**
 * Messages live in a `message/<sessionId>/` directory sibling to `session/`.
 * Only the count is kept — message bodies never leave the reader.
 */
async function countMessages(sessionDir: string, sessionId: string): Promise<number> {
  const messageDir = join(dirname(sessionDir), "message", sessionId);
  return (await safeReaddir(messageDir)).filter((f) => f.endsWith(".json")).length;
}

export class OpenCodeSessionReader implements SessionReader {
  readonly source = "opencode" as const;

  constructor(private readonly configuredRoots: string[] = resolveRoots()) {}

  roots(): string[] {
    return this.configuredRoots;
  }

  async read(): Promise<RawSession[]> {
    const sessions: RawSession[] = [];

    for (const root of this.configuredRoots) {
      if (!(await dirExists(root))) continue;

      for (const sessionDir of await findDirsNamed(root, "session")) {
        for (const file of await collectJsonFiles(sessionDir)) {
          const raw = await safeReadJson<OpencodeSession>(file);
          if (!raw?.id) continue;
          // Sub-agent sessions are an implementation detail of the parent run,
          // not work an operator tracks on a board.
          if (raw.parentID) continue;

          const created = toEpochMs(raw.time?.created);
          const updated = toEpochMs(raw.time?.updated) || created;

          sessions.push({
            sessionId: raw.id,
            source: this.source,
            title: toTitle(raw.title ?? "", "Untitled session"),
            cwd: raw.directory ?? "",
            branch: null, // OpenCode does not record a branch in the session file
            messageCount: await countMessages(sessionDir, raw.id),
            createdAt: created,
            updatedAt: updated,
            explicitStatus: raw.time?.completed ? "done" : null,
          });
        }
      }
    }

    return sessions;
  }
}

function resolveRoots(): string[] {
  const override = process.env.VIBE_OPENCODE_SESSIONS_DIR;
  if (override)
    return override
      .split(",")
      .map((p) => expandHome(p.trim()))
      .filter(Boolean);

  const roots = [...DEFAULT_ROOTS];
  if (process.env.XDG_DATA_HOME) roots.unshift(join(process.env.XDG_DATA_HOME, "opencode"));
  if (process.env.APPDATA) roots.push(join(process.env.APPDATA, "opencode"));
  return roots.map(expandHome);
}
