import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillPayload } from "@vibe-code/shared";
import type { Subprocess } from "bun";
import type { AgentEngine, AgentEvent, EngineOptions } from "../engine";
import { getLiteLLMBaseUrl, listLiteLLMModels } from "../litellm-client";
import { streamProcess } from "../stream-process";

const NO_PLAN_MODE_GUARD = [
  "SYSTEM: You are in implementation mode.",
  "Do NOT enter Plan Mode.",
  "Do NOT call the enter_plan_mode tool.",
  "Execute the task directly by editing project files in the current workspace.",
].join("\n");

export class GeminiEngine implements AgentEngine {
  name = "gemini";
  displayName = "Gemini CLI";
  private processes = new Map<string, Subprocess>();

  private buildGeminiChildEnv(
    litellmKey?: string,
    litellmBaseUrl?: string,
    nativeGeminiKey?: string
  ): NodeJS.ProcessEnv {
    const env = { ...process.env };
    // Avoid Gemini IDE client binding when running in detached task worktrees.
    const keysToDelete = [
      "GEMINI_CLI_IDE_SERVER_PORT",
      "GEMINI_CLI_IDE_WORKSPACE_PATH",
      "GEMINI_CLI_IDE_AUTH_TOKEN",
      "TERM_PROGRAM",
      "VSCODE_INJECTION",
      "VSCODE_GIT_ASKPASS_NODE",
      "VSCODE_GIT_ASKPASS_EXTRA_ARGS",
      "VSCODE_GIT_ASKPASS_MAIN",
      "VSCODE_GIT_IPC_HANDLE",
    ];
    keysToDelete.forEach((key) => {
      delete env[key];
    });
    // When LiteLLM is enabled, route through the proxy.
    // Otherwise, prefer the DB-stored native key, then fall back to process.env.
    if (litellmKey) {
      env.GOOGLE_GEMINI_BASE_URL = litellmBaseUrl;
      env.GEMINI_API_KEY = litellmKey;
    } else if (nativeGeminiKey) {
      env.GEMINI_API_KEY = nativeGeminiKey;
    }
    return env;
  }

  private async hasCli(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["gemini", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  private parseProviderLoadSignals(line: string): {
    skills?: number;
    agents?: number;
    tools?: number;
  } {
    const out: { skills?: number; agents?: number; tools?: number } = {};
    const skillMatch = line.match(/(?:loaded|using|enabled)\s+(\d+)\s+skills?/i);
    const agentMatch = line.match(/(?:loaded|using|enabled)\s+(\d+)\s+agents?/i);
    const toolMatch = line.match(/(?:loaded|using|enabled)\s+(\d+)\s+tools?/i);
    if (skillMatch?.[1]) out.skills = Number(skillMatch[1]);
    if (agentMatch?.[1]) out.agents = Number(agentMatch[1]);
    if (toolMatch?.[1]) out.tools = Number(toolMatch[1]);
    return out;
  }

  private deriveStatusFromLine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const installProgressMatch = trimmed.match(
      /(progress|resolved|reused|downloaded|added\s+\d+\s+packages?|packages:\s*[+-]\d+)/i
    );
    if (installProgressMatch) {
      const compact = trimmed.replace(/\s+/g, " ");
      return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
    }

    if (/tool execution denied by policy/i.test(trimmed)) {
      return "Tool bloqueada por policy; trocando estrategia...";
    }

    if (/missing pgrep output/i.test(trimmed)) {
      return "Ferramenta tentou pgrep; usando alternativa permitida...";
    }

    if (/switching to plan mode|enter_plan_mode/i.test(trimmed)) {
      return "Plan Mode detectado: continuar em implementation mode (sem enter_plan_mode).";
    }

    return null;
  }

  async isAvailable(): Promise<boolean> {
    return this.hasCli();
  }

  async getVersion(): Promise<string | null> {
    try {
      const proc = Bun.spawn(["gemini", "--version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) return null;
      const text = await new Response(proc.stdout).text();
      return text.trim().split("\n")[0] || null;
    } catch {
      return null;
    }
  }

  async listModels(): Promise<string[]> {
    // Return Google/Gemini models available in LiteLLM (auto-routed via GEMINI_API_KEY).
    const all = await listLiteLLMModels(getLiteLLMBaseUrl());
    return all.filter((m) => m.startsWith("gemini/") || m.startsWith("gemini-"));
  }

  async getSetupIssue(): Promise<string | null> {
    if (!(await this.hasCli())) return "Gemini CLI não instalado";
    return null;
  }

  async prepareWorkdir(workdir: string, skills: SkillPayload): Promise<string[]> {
    const sections: string[] = [];

    if (skills.projectInstructions) {
      sections.push(`## Project Instructions\n\n${skills.projectInstructions}`);
    }

    if (skills.rules.length > 0) {
      sections.push("## Coding Standards\n");
      for (const rule of skills.rules) {
        const body = rule.content
          ? `\n<details><summary>${rule.description}</summary>\n\n${rule.content}\n</details>`
          : rule.description;
        sections.push(`### ${rule.name}\n${body}`);
      }
    }

    if (skills.skills.length > 0) {
      sections.push("## Skills\n");
      for (const skill of skills.skills) {
        const body = skill.content
          ? `\n<details><summary>${skill.description}</summary>\n\n${skill.content}\n</details>`
          : skill.description;
        sections.push(`### ${skill.name}\n${body}`);
      }
    }

    if (skills.agents.length > 0) {
      sections.push("## Agent Personas\n");
      for (const agent of skills.agents) {
        sections.push(`### ${agent.name}\n${agent.content || agent.description}`);
      }
    }

    if (skills.workflow) {
      sections.push(
        `## Workflow: ${skills.workflow.name}\n${skills.workflow.content || skills.workflow.description}`
      );
    }

    if (sections.length === 0) return [];

    const geminiMd = join(workdir, "GEMINI.md");
    await writeFile(geminiMd, sections.join("\n\n"), "utf8");
    return [geminiMd];
  }

  async *execute(
    prompt: string,
    workdir: string,
    options: EngineOptions
  ): AsyncGenerator<AgentEvent> {
    yield { type: "log", stream: "system", content: `[gemini] Starting in ${workdir}` };
    yield {
      type: "log",
      stream: "system",
      content: `[gemini] Run context: model=${options.model ?? "default"}, runId=${options.runId ?? "n/a"}`,
    };

    const args = ["gemini", "--yolo"];
    if (options.model) args.push("-m", options.model);
    const guardedPrompt = `${NO_PLAN_MODE_GUARD}\n\n${prompt}`;
    args.push("-p", guardedPrompt);

    const proc = Bun.spawn(args, {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: this.buildGeminiChildEnv(
        options.litellmKey,
        options.litellmBaseUrl,
        options.nativeApiKeys?.gemini
      ),
    });

    yield {
      type: "log",
      stream: "system",
      content: options.litellmKey
        ? "[gemini] Process started with LiteLLM proxy (GOOGLE_GEMINI_BASE_URL + GEMINI_API_KEY injected)"
        : options.nativeApiKeys?.gemini
          ? "[gemini] Process started with Gemini API key from settings"
          : "[gemini] Process started with native credentials (GEMINI_API_KEY must be set in server env)",
    };

    if (options.runId) this.processes.set(options.runId, proc);

    const providerLoad = {
      skills: null as number | null,
      agents: null as number | null,
      tools: null as number | null,
    };

    for await (const event of streamProcess(
      proc,
      (line) => {
        const status = this.deriveStatusFromLine(line);
        if (status) {
          // Yield only the status event — the log would be redundant when a status is derived
          return [
            { type: "status", content: status },
            { type: "log", stream: "stdout", content: line },
          ] satisfies AgentEvent[];
        }

        const events: AgentEvent[] = [{ type: "log", stream: "stdout", content: line }];

        if (line.includes("you must specify the GEMINI_API_KEY environment variable")) {
          events.push({
            type: "log",
            stream: "system",
            content: options.litellmKey
              ? "[gemini] LiteLLM proxy key rejected. Check LITELLM_BASE_URL and the virtual key."
              : "[gemini] GEMINI_API_KEY not found. Add it in Settings → API Keys.",
          });
        }
        return events;
      },
      options.signal
    )) {
      if (event.type === "log" && event.content) {
        const parsed = this.parseProviderLoadSignals(event.content);
        if (parsed.skills !== undefined) providerLoad.skills = parsed.skills;
        if (parsed.agents !== undefined) providerLoad.agents = parsed.agents;
        if (parsed.tools !== undefined) providerLoad.tools = parsed.tools;
      }
      yield event;
    }

    yield {
      type: "log",
      stream: "system",
      content:
        `[gemini] Provider load summary: ` +
        `skills=${providerLoad.skills ?? "n/a"}, ` +
        `agents=${providerLoad.agents ?? "n/a"}, ` +
        `tools=${providerLoad.tools ?? "n/a"}`,
    };

    if (options.runId) this.processes.delete(options.runId);
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
