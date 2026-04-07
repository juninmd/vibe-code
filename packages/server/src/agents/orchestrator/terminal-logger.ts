/**
 * Colored terminal logger for server-side agent activity.
 * All agent events that go to the browser also appear here in real-time.
 */

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  gray: "\x1b[90m",
};

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

function taskTag(taskId: string): string {
  return `${c.gray}[${c.blue}${taskId.slice(0, 8)}${c.gray}]${c.reset}`;
}

function streamColor(stream: string): string {
  switch (stream) {
    case "stdout":
      return c.white;
    case "stderr":
      return c.yellow;
    case "system":
      return c.cyan;
    case "stdin":
      return c.magenta;
    case "review":
      return c.green;
    default:
      return c.dim;
  }
}

function streamPrefix(stream: string): string {
  switch (stream) {
    case "stdout":
      return "│";
    case "stderr":
      return "⚠";
    case "system":
      return "→";
    case "stdin":
      return "←";
    case "review":
      return "◎";
    default:
      return "·";
  }
}

export function logAgentEvent(taskId: string, stream: string, content: string): void {
  if (!content?.trim()) return;
  const color = streamColor(stream);
  const prefix = streamPrefix(stream);
  const tag = taskTag(taskId);
  const time = `${c.dim}[${ts()}]${c.reset}`;

  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    process.stdout.write(`${time} ${tag} ${color}${prefix} ${trimmed}${c.reset}\n`);
  }
}

export function logAgentStart(taskId: string, engine: string, model: string, repo: string): void {
  const tag = taskTag(taskId);
  const time = `${c.dim}[${ts()}]${c.reset}`;
  process.stdout.write(
    `\n${time} ${tag} ${c.bold}${c.green}▶ AGENT STARTED${c.reset} ` +
      `engine=${c.cyan}${engine}${c.reset} ` +
      `model=${c.magenta}${model}${c.reset} ` +
      `repo=${c.blue}${repo}${c.reset}\n`
  );
}

export function logAgentFinish(
  taskId: string,
  status: "completed" | "failed" | "cancelled",
  detail?: string
): void {
  const tag = taskTag(taskId);
  const time = `${c.dim}[${ts()}]${c.reset}`;
  const icon = status === "completed" ? "✓" : status === "cancelled" ? "⊘" : "✗";
  const color = status === "completed" ? c.green : status === "cancelled" ? c.yellow : c.red;
  process.stdout.write(
    `${time} ${tag} ${color}${c.bold}${icon} AGENT ${status.toUpperCase()}${c.reset}` +
      (detail ? ` ${c.dim}${detail}${c.reset}` : "") +
      "\n\n"
  );
}

export function logOrchestratorEvent(
  message: string,
  level: "info" | "warn" | "error" = "info"
): void {
  const time = `${c.dim}[${ts()}]${c.reset}`;
  const tag = `${c.gray}[orchestrator]${c.reset}`;
  const color = level === "error" ? c.red : level === "warn" ? c.yellow : c.cyan;
  const icon = level === "error" ? "✗" : level === "warn" ? "!" : "◆";
  process.stdout.write(`${time} ${tag} ${color}${icon} ${message}${c.reset}\n`);
}
