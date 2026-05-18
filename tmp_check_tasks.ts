import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const db = new Database(join(homedir(), ".vibe-code", "vibe.db"));
const rows = db.query(
  "SELECT id, substr(title,1,60) as title, status, created_at FROM tasks ORDER BY created_at DESC LIMIT 15"
).all();
console.log(JSON.stringify(rows, null, 2));
