import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeSessionReader } from "./opencode";

const NOW = Date.parse("2026-08-05T12:00:00.000Z");

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "oc-reader-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Minimal stand-in for the `opencode.db` an OpenCode v2 install writes. */
function writeV2Database(path: string): void {
  const db = new Database(path);
  db.run(
    `create table session_v2 (
       id text primary key, title text, directory text,
       time_created integer, time_updated integer,
       parent_id text, time_archived integer)`
  );
  db.run("create table session_message (id text primary key, session_id text)");
  db.run("insert into session_v2 values ('ses_1', 'Ship it', 'D:/dev/app', ?, ?, null, null)", [
    NOW - 600_000,
    NOW - 60_000,
  ]);
  // Sub-agent sessions and archived ones are not board cards.
  db.run(
    "insert into session_v2 values ('ses_child', 'child', 'D:/dev/app', ?, ?, 'ses_1', null)",
    [NOW, NOW]
  );
  db.run("insert into session_v2 values ('ses_arch', 'archived', 'D:/dev/app', ?, ?, null, ?)", [
    NOW,
    NOW,
    NOW,
  ]);
  db.run("insert into session_message values ('m1', 'ses_1')");
  db.run("insert into session_message values ('m2', 'ses_1')");
  db.close();
}

describe("OpenCodeSessionReader", () => {
  it("reads sessions from the v2 SQLite store", async () => {
    writeV2Database(join(root, "opencode.db"));

    const sessions = await new OpenCodeSessionReader([root]).read();

    expect(sessions.map((session) => session.sessionId)).toEqual(["ses_1"]);
    expect(sessions[0]).toMatchObject({
      source: "opencode",
      title: "Ship it",
      cwd: "D:/dev/app",
      messageCount: 2,
      createdAt: NOW - 600_000,
      updatedAt: NOW - 60_000,
    });
  });

  it("still reads the legacy per-file JSON store", async () => {
    const dir = join(root, "storage", "session");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "ses_old.json"),
      JSON.stringify({
        id: "ses_old",
        title: "Old session",
        directory: "D:/dev/old",
        time: { created: NOW - 1000, updated: NOW - 500 },
      })
    );

    const sessions = await new OpenCodeSessionReader([root]).read();

    expect(sessions.map((session) => session.sessionId)).toEqual(["ses_old"]);
    expect(sessions[0].cwd).toBe("D:/dev/old");
  });

  it("reads nothing when the store is missing", async () => {
    expect(await new OpenCodeSessionReader([join(root, "missing")]).read()).toEqual([]);
    expect(await new OpenCodeSessionReader([root]).read()).toEqual([]);
  });
});
