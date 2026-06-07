#!/usr/bin/env node
/**
 * Proxy for @modelcontextprotocol/server-github that coerces boolean fields
 * passed as strings by weaker models (deepseek, etc.).
 *
 * Intercepts tool calls to github_create_pull_request and fixes:
 *   draft: "true"/"false" -> true/false
 *   maintainer_can_modify: "true"/"false" -> true/false
 *
 * Passes all other traffic through unchanged.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const BOOL_FIELDS = new Set(["draft", "maintainer_can_modify"]);

function coerceBooleans(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const result = { ...obj };
  for (const key of BOOL_FIELDS) {
    if (key in result && typeof result[key] === "string") {
      result[key] = result[key].toLowerCase() === "true";
    }
  }
  return result;
}

function processMessage(line) {
  try {
    const msg = JSON.parse(line);
    if (
      msg.method === "tools/call" &&
      msg.params?.name === "github_create_pull_request" &&
      msg.params?.arguments
    ) {
      msg.params.arguments = coerceBooleans(msg.params.arguments);
    }
    return JSON.stringify(msg);
  } catch {
    return line;
  }
}

// Spawn the real GitHub MCP server
const child = spawn(
  "npx",
  ["-y", "@modelcontextprotocol/server-github", ...process.argv.slice(2)],
  {
    env: process.env,
    stdio: ["pipe", "pipe", "inherit"],
  }
);

// stdin -> child (intercept and fix)
const stdinRl = createInterface({ input: process.stdin, crlfDelay: Infinity });
stdinRl.on("line", (line) => {
  if (line.trim()) {
    child.stdin.write(processMessage(line) + "\n");
  }
});
stdinRl.on("close", () => child.stdin.end());

// child stdout -> our stdout (pass through)
const childRl = createInterface({ input: child.stdout, crlfDelay: Infinity });
childRl.on("line", (line) => {
  if (line.trim()) process.stdout.write(line + "\n");
});

child.on("exit", (code) => process.exit(code ?? 0));
