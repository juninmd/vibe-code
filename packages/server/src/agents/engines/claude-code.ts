import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillPayload, SkillPayloadItem } from "@vibe-code/shared";
import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { getLiteLLMBaseUrl, listLiteLLMModels } from "../litellm-client";
import { streamProcess } from "../stream-process";
import { getHeartbeatIntervalMs, withHeartbeat } from "./heartbeat";

const NATIVE_CLAUDE_CODE_MODELS = [
  "sonnet",
  "opus",
  "haiku",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
];

const CLAUDE_SKILLS_FILE = join(".claude", "VIBE_CODE_SKILLS.md");

function parseClaudeCodeLine(line: string): AgentEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const eventType = String(parsed.type ?? "");
    const subtype = String(parsed.subtype ?? "");

    if (eventType === "system" && subtype === "init") {
      const sessionId = String(parsed.session_id ?? "");
      return [
        ...(sessionId ? [{ type: "session" as const, sessionId }] : []),
        {
          type: "log" as const,
          stream: "system" as const,
          content: `[claude-init] ${trimmed.slice(0, 200)}`,
        },
      ];
    }

    if (eventType === "assistant") {
      const message = parsed.message as Record<string, unknown> | undefined;
      const content = message?.content as Array<Record<string, unknown>> | undefined;
      if (content) {
        const events: AgentEvent[] = [];
        for (const block of content) {
          if (block.type === "text" && block.text) {
            events.push({ type: "log", stream: "stdout", content: String(block.text) });
          } else if (block.type === "tool_use") {
            events.push({
              type: "tool_use",
              toolUse: {
                toolId: String(block.id ?? ""),
                toolName: String(block.name ?? "unknown"),
                parameters: (block.input ?? {}) as Record<string, unknown>,
              },
            });
          }
        }
        return events;
      }
    }

    if (eventType === "user") {
      const message = parsed.message as Record<string, unknown> | undefined;
      const content = message?.content as Array<Record<string, unknown>> | undefined;
      if (content) {
        const events: AgentEvent[] = [];
        for (const block of content) {
          if (block.type === "tool_result") {
            const isError = Boolean(block.is_error);
            events.push({
              type: "tool_result",
              toolResult: {
                toolId: String(block.tool_use_id ?? ""),
                output: String(block.content ?? ""),
                status: isError ? "error" : "success",
              },
            });
          }
        }
        return events;
      }
    }

    if (eventType === "result") {
      const costStats: Record<string, unknown> = {};
      if (parsed.total_cost_usd != null) costStats.total_cost_usd = parsed.total_cost_usd;
      if (parsed.usage) Object.assign(costStats, parsed.usage);
      if (parsed.modelUsage) Object.assign(costStats, parsed.modelUsage);
      if (parsed.duration_ms != null) costStats.duration_ms = parsed.duration_ms;
      return [{ type: "cost", costStats: costStats as AgentEvent["costStats"] }];
    }

    if (eventType === "rate_limit_event") {
      const info = parsed.rate_limit_info as Record<string, unknown> | undefined;
      return [
        {
          type: "log",
          stream: "system",
          content: `[rate-limit] utilization=${info?.utilization ?? "n/a"}, resetsAt=${info?.resetsAt ?? "n/a"}`,
        },
      ];
    }

    if (eventType === "error") {
      const msg = String(parsed.message ?? parsed.error ?? "Unknown error");
      return [
        { type: "log", stream: "stderr", content: msg },
        { type: "error", content: msg },
      ];
    }

    return [];
  } catch {
    return trimmed ? [{ type: "log", stream: "stdout", content: trimmed }] : [];
  }
}

export class ClaudeCodeEngine implements AgentEngine {
  name = "claude-code";
  displayName = "Claude Code";
  private processes = new Map<string, Subprocess>();

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["claude", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const proc = Bun.spawn(["claude", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) return null;
      const text = await new Response(proc.stdout).text();
      return text.trim().split("\n")[0] || null;
    } catch {
      return null;
    }
  }

  private skillSlug(category: string, name: string, index: number): string {
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 48) || `item-${index + 1}`;
    return `vibe-code-${category}-${slug}`;
  }

  private formatSkillMarkdown(
    category: string,
    skill: SkillPayloadItem,
    generatedName: string
  ): string {
    const description = [
      `Vibe Code selected ${category}: ${skill.description}`,
      "Use when this task matches the selected Vibe Code context for the current run.",
    ]
      .join(" ")
      .replace(/\r?\n/g, " ")
      .trim();
    return [
      "---",
      `name: ${generatedName}`,
      "description: |-",
      `  ${description || "Vibe Code selected skill for this run."}`,
      "---",
      "",
      `# ${skill.name}`,
      "",
      `Category: ${category}`,
      "",
      "These instructions were selected by Vibe Code for this run. Follow them when they apply to the task, repository, or validation flow.",
      "",
      skill.content.trim() || skill.description,
      "",
    ].join("\n");
  }

  private formatSkillsContext(skills: SkillPayload): string {
    const selected = this.collectSelectedSkills(skills);
    const sections = [
      "# Vibe Code Selected Skills",
      "",
      "These instructions were selected by Vibe Code for this run. Follow them when they apply to the task, repository, or validation flow.",
    ];
    for (const { category, item } of selected) {
      sections.push("", `## ${category}: ${item.name}`, "", item.description, "", item.content);
    }
    if (skills.projectInstructions) {
      sections.push("", "## Project Instructions", "", skills.projectInstructions);
    }
    return `${sections.join("\n").trim()}\n`;
  }

  private collectSelectedSkills(skills: SkillPayload): Array<{
    category: string;
    item: SkillPayloadItem;
  }> {
    const rules = skills.rules ?? [];
    const selectedSkills = skills.skills ?? [];
    const agents = skills.agents ?? [];
    return [
      ...rules.map((item) => ({ category: "rule", item })),
      ...selectedSkills.map((item) => ({ category: "skill", item })),
      ...agents.map((item) => ({ category: "agent", item })),
      ...(skills.workflow ? [{ category: "workflow", item: skills.workflow }] : []),
    ];
  }

  async listModels(): Promise<string[]> {
    const models = new Set(NATIVE_CLAUDE_CODE_MODELS);
    try {
      const all = await listLiteLLMModels(getLiteLLMBaseUrl());
      for (const m of all.filter((m) => m.startsWith("anthropic/") || m.startsWith("claude-"))) {
        models.add(m);
      }
    } catch {
      // ignore
    }
    return Array.from(models);
  }

  async prepareWorkdir(workdir: string, skills: SkillPayload): Promise<string[]> {
    const selected = this.collectSelectedSkills(skills);
    if (selected.length === 0 && !skills.projectInstructions) return [];
    const writtenFiles: string[] = [];
    const outputPath = join(workdir, CLAUDE_SKILLS_FILE);
    await mkdir(join(workdir, ".claude"), { recursive: true });
    await writeFile(outputPath, this.formatSkillsContext(skills), "utf8");
    writtenFiles.push(outputPath);
    const skillRoot = join(workdir, ".claude", "skills");
    for (const [index, selectedSkill] of selected.entries()) {
      const generatedName = this.skillSlug(selectedSkill.category, selectedSkill.item.name, index);
      const skillDir = join(skillRoot, generatedName);
      const skillPath = join(skillDir, "SKILL.md");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        skillPath,
        this.formatSkillMarkdown(selectedSkill.category, selectedSkill.item, generatedName),
        "utf8"
      );
      writtenFiles.push(skillPath);
    }
    return writtenFiles;
  }

  async *execute(
    prompt: string,
    workdir: string,
    options: EngineOptions
  ): AsyncGenerator<AgentEvent> {
    yield { type: "log", stream: "system", content: `[claude-code] Starting in ${workdir}` };

    const promptFile = `/tmp/vibe-claude-code-prompt-${options.runId ?? Date.now()}.txt`;
    await writeFile(promptFile, prompt, "utf8");

    const args = [
      "claude",
      "-p",
      `@${promptFile}`,
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
    ];
    if (options.model) args.splice(2, 0, "--model", options.model);
    if (options.resumeSessionId) args.push("--resume", options.resumeSessionId);

    const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
    if (options.litellmKey) {
      env.ANTHROPIC_BASE_URL = options.litellmBaseUrl;
      env.ANTHROPIC_API_KEY = options.litellmKey;
    } else if (options.nativeApiKeys?.anthropic) {
      env.ANTHROPIC_API_KEY = options.nativeApiKeys.anthropic;
    }

    const proc = Bun.spawn(args, {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env,
    });

    if (options.runId) this.processes.set(options.runId, proc);

    yield* withHeartbeat(
      streamProcess(proc, (line) => parseClaudeCodeLine(line), options.signal),
      getHeartbeatIntervalMs(),
      options.signal
    );

    if (options.runId) this.processes.delete(options.runId);

    try {
      await unlink(promptFile);
    } catch {
      // ignore cleanup errors
    }
  }

  abort(runId: string): void {
    const proc = this.processes.get(runId);
    if (proc) {
      proc.kill();
      this.processes.delete(runId);
    }
  }

  sendInput(runId: string, input: string): boolean {
    const proc = this.processes.get(runId);
    if (!proc?.stdin || typeof proc.stdin === "number") return false;
    try {
      const sink = proc.stdin as import("bun").FileSink;
      sink.write(`${input}\n`);
      sink.flush();
      return true;
    } catch {
      return false;
    }
  }
}
