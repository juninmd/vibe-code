import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillPayload, SkillPayloadItem } from "@vibe-code/shared";
import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { getLiteLLMBaseUrl, listLiteLLMModels } from "../litellm-client";
import { streamProcess } from "../stream-process";
import type { CodexDebugModelsResponse } from "./codex-types";
import { getHeartbeatIntervalMs, withHeartbeat } from "./heartbeat";

const NATIVE_CODEX_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2",
  "codex-auto-review",
];

function parseCodexLine(line: string): AgentEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const eventType = String(parsed.type ?? "");

    if (eventType === "thread.started") {
      const threadId = String(parsed.thread_id ?? "");
      return [
        ...(threadId ? [{ type: "session" as const, sessionId: threadId }] : []),
        { type: "log" as const, stream: "system" as const, content: `[codex-thread] ${threadId}` },
      ];
    }

    if (eventType === "item.started") {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (item?.type === "command_execution") {
        return [
          {
            type: "tool_use",
            toolUse: {
              toolId: String(item.id ?? ""),
              toolName: "exec_command",
              parameters: { command: String(item.command ?? "") },
            },
          },
        ];
      }
    }

    if (eventType === "item.completed") {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (!item) return [];
      if (item.type === "command_execution") {
        const exitCode = Number(item.exit_code ?? 0);
        const status = String(item.status ?? "");
        return [
          {
            type: "tool_result",
            toolResult: {
              toolId: String(item.id ?? ""),
              output: String(item.aggregated_output ?? item.output ?? ""),
              status: status === "completed" && exitCode === 0 ? "success" : "error",
            },
          },
        ];
      }
      if (item.type === "agent_message") {
        const text = String(item.text ?? "");
        return text ? [{ type: "log", stream: "stdout", content: text }] : [];
      }
    }

    if (eventType === "turn.completed") {
      const usage = parsed.usage as Record<string, unknown> | undefined;
      if (usage) {
        const costStats: Record<string, unknown> = { ...usage };
        const total =
          Number(usage.input_tokens ?? 0) +
          Number(usage.cached_input_tokens ?? 0) +
          Number(usage.output_tokens ?? 0) +
          Number(usage.reasoning_output_tokens ?? 0);
        costStats.total_tokens = total;
        return [{ type: "cost", costStats: costStats as AgentEvent["costStats"] }];
      }
    }

    if (eventType === "error" || eventType === "turn.failed" || eventType === "turn.error") {
      const msg = String(parsed.error ?? parsed.message ?? "");
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

export class CodexEngine implements AgentEngine {
  name = "codex";
  displayName = "Codex";
  private processes = new Map<string, Subprocess>();

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["codex", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const proc = Bun.spawn(["codex", "--version"], { stdout: "pipe", stderr: "pipe" });
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
    const descriptionBlock = description
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
    return [
      "---",
      `name: ${generatedName}`,
      "description: |-",
      descriptionBlock || "  Vibe Code selected skill for this run.",
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

  private collectSelectedSkills(skills: SkillPayload): Array<{
    category: string;
    item: SkillPayloadItem;
  }> {
    return [
      ...(skills.rules ?? []).map((item) => ({ category: "rule", item })),
      ...(skills.skills ?? []).map((item) => ({ category: "skill", item })),
      ...(skills.agents ?? []).map((item) => ({ category: "agent", item })),
      ...(skills.workflow ? [{ category: "workflow", item: skills.workflow }] : []),
    ];
  }

  async listModels(): Promise<string[]> {
    const nativeModels = new Set(NATIVE_CODEX_MODELS);
    try {
      const proc = Bun.spawn(["codex", "debug", "models"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode === 0) {
        const text = (await new Response(proc.stdout).text()).replace(/^﻿/, "");
        const parsed = JSON.parse(text) as CodexDebugModelsResponse;
        for (const model of parsed.models ?? []) {
          const id = model.slug ?? model.id;
          if (id) nativeModels.add(id);
        }
      }
    } catch {
      // Fall back to curated native catalog.
    }
    try {
      const litellm = await listLiteLLMModels(getLiteLLMBaseUrl());
      for (const m of litellm) nativeModels.add(m);
    } catch {
      // ignore
    }
    return Array.from(nativeModels);
  }

  async prepareWorkdir(workdir: string, skills: SkillPayload): Promise<string[]> {
    const selectedSkills = this.collectSelectedSkills(skills);
    if (selectedSkills.length === 0) return [];
    const writtenFiles: string[] = [];
    const skillRoot = join(workdir, ".agents", "skills");
    for (const [index, selected] of selectedSkills.entries()) {
      const generatedName = this.skillSlug(selected.category, selected.item.name, index);
      const skillDir = join(skillRoot, generatedName);
      const skillPath = join(skillDir, "SKILL.md");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        skillPath,
        this.formatSkillMarkdown(selected.category, selected.item, generatedName),
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
    yield { type: "log", stream: "system", content: `[codex] Starting in ${workdir}` };

    const args = [
      "codex",
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "-",
    ];
    if (options.model) args.splice(2, 0, "--model", options.model);
    if (options.resumeSessionId) {
      args.splice(
        0,
        args.length,
        "codex",
        "--ask-for-approval",
        "never",
        "exec",
        "resume",
        "--json",
        options.resumeSessionId,
        "-"
      );
    }

    const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
    if (options.litellmKey) {
      delete env.ANTHROPIC_API_KEY;
      delete env.GEMINI_API_KEY;
      env.OPENAI_API_KEY = options.litellmKey;
      env.OPENAI_API_BASE = `${options.litellmBaseUrl}/v1`;
    } else {
      if (options.nativeApiKeys?.openai) env.OPENAI_API_KEY = options.nativeApiKeys.openai;
      if (options.nativeApiKeys?.anthropic) env.ANTHROPIC_API_KEY = options.nativeApiKeys.anthropic;
      if (options.nativeApiKeys?.gemini) env.GEMINI_API_KEY = options.nativeApiKeys.gemini;
    }

    const proc = Bun.spawn(args, {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env,
    });

    if (options.runId) this.processes.set(options.runId, proc);

    const sink = proc.stdin as import("bun").FileSink;
    sink.write(prompt);
    sink.end();

    yield* withHeartbeat(
      streamProcess(proc, (line) => parseCodexLine(line), options.signal),
      getHeartbeatIntervalMs(),
      options.signal
    );
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
