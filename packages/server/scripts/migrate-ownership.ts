#!/usr/bin/env bun
/**
 * Workspace -> account ownership migration (issue #262).
 *
 *   bun run scripts/migrate-ownership.ts --db /data/vibe.db --map ownership.json
 *   bun run scripts/migrate-ownership.ts --db /data/vibe.db --map ownership.json --apply
 *
 * The map is an explicit JSON object `{ "<workspaceId>": "<accountId>" }`.
 * Dry run is the default; it never writes. `--apply` refuses to write while any
 * issue is present (unmapped workspace, orphan repository/task, unknown account
 * or conflicting owner) and is idempotent: a second run applies nothing.
 *
 * Exit codes: 0 report produced, 2 apply blocked by issues, 1 invalid input.
 */
import { readFileSync } from "node:fs";
import { createDb } from "../src/db";
import { formatOwnershipReport, migrateOwnership } from "../src/migrations/ownership";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dataDir = process.env.VIBE_CODE_DATA_DIR;
const resolvedDb =
  argument("--db") ??
  process.env.VIBE_CODE_DB_PATH ??
  (dataDir ? `${dataDir.replace(/[\\/]+$/, "")}/vibe.db` : undefined);
const mapPath = argument("--map");
const apply = process.argv.includes("--apply");
const json = process.argv.includes("--json");

if (!mapPath) {
  console.error("usage: migrate-ownership.ts --map <map.json> [--db <vibe.db>] [--apply] [--json]");
  process.exit(1);
}

if (!resolvedDb) {
  console.error("Set --db, VIBE_CODE_DB_PATH or VIBE_CODE_DATA_DIR");
  process.exit(1);
}

let mapping: Record<string, string>;
try {
  mapping = JSON.parse(readFileSync(mapPath, "utf8")) as Record<string, string>;
} catch (err) {
  console.error(`Invalid map ${mapPath}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const db = createDb(resolvedDb);
try {
  const report = migrateOwnership(db, mapping, { dryRun: !apply });
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatOwnershipReport(report));
  if (!report.dryRun && !report.ready) process.exit(2);
} finally {
  db.close();
}
