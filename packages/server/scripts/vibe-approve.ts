#!/usr/bin/env bun
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    message: { type: "string", short: "m" },
    command: { type: "string", short: "c" },
  },
});

const message = values.message || "Requesting approval for a sensitive action";
const command = values.command;
const taskId = process.env.VIBE_CODE_TASK_ID;
const apiUrl = process.env.VIBE_CODE_API_URL || "http://localhost:3000";

if (!taskId) {
  console.error("VIBE_CODE_TASK_ID not set");
  process.exit(1);
}

console.log(`🔒 Governance Gate: ${message}`);
if (command) console.log(`👉 Command: ${command}`);
console.log("⏳ Waiting for human approval in Vibe-Code UI...");

async function requestApproval() {
  const resp = await fetch(`${apiUrl}/api/tasks/${taskId}/approve/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, command }),
  });
  return resp.ok;
}

async function checkStatus() {
  const resp = await fetch(`${apiUrl}/api/tasks/${taskId}/approve/status`);
  if (!resp.ok) return "pending";
  const data = await resp.json();
  return data.status; // "approved", "rejected", or "pending"
}

const requested = await requestApproval();
if (!requested) {
  console.error("Failed to submit approval request");
  process.exit(1);
}

// Poll for approval
while (true) {
  const status = await checkStatus();
  if (status === "approved") {
    console.log("✅ Approved! Proceeding...");
    if (command) {
      const proc = Bun.spawn(command.split(" "), { stdout: "inherit", stderr: "inherit" });
      await proc.exited;
      process.exit(proc.exitCode);
    }
    process.exit(0);
  } else if (status === "rejected") {
    console.error("❌ Rejected by human.");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
