#!/usr/bin/env bun
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    title: { type: "string", short: "t" },
    description: { type: "string", short: "d" },
    repoId: { type: "string" },
    parentTaskId: { type: "string" },
  },
  allowPositionals: true,
});

const command = positionals[0];

if (command !== "create") {
  console.error("Usage: vibe-task create --title <title> [--description <desc>]");
  process.exit(1);
}

const title = values.title;
const description = values.description || "";
const repoId = values.repoId || process.env.VIBE_CODE_REPO_ID;
const parentTaskId = values.parentTaskId || process.env.VIBE_CODE_PARENT_TASK_ID;
const apiUrl = process.env.VIBE_CODE_API_URL || "http://localhost:3000";

if (!title || !repoId) {
  console.error("Missing required arguments: title and repoId (or VIBE_CODE_REPO_ID env)");
  process.exit(1);
}

try {
  const resp = await fetch(`${apiUrl}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      description,
      repoId,
      parentTaskId,
      status: "backlog",
      priority: 0,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`Failed to create task: ${err}`);
    process.exit(1);
  }

  const data = await resp.json();
  console.log(`Successfully created sub-task: ${data.data.id}`);
} catch (err) {
  console.error(`Error connecting to Vibe-Code API: ${err}`);
  process.exit(1);
}
