import type { Task } from "@vibe-code/shared";

export function buildPrompt(task: Task): string {
  const lines: string[] = [];
  lines.push(`# ${task.title}`);
  if (task.description?.trim()) {
    lines.push(`## Requirements\n${task.description.trim()}`);
  }
  lines.push(
    "## Instructions\n" +
      "Implement ALL requirements listed above exactly as described. " +
      "Create, edit, or delete files as needed — including full file content when asked to create a file. " +
      "Do not ask clarifying questions. Commit your changes when done."
  );
  return lines.join("\n\n");
}
