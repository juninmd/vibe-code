import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../engine";
import { DEFAULT_OPENCODE_MODEL, humanizeStderr, OpenCodeEngine } from "./opencode";

// ─── Test helper ──────────────────────────────────────────────────────────────
// Replaces the opencode CLI with an inline Bun script for deterministic tests.

class FakeOpenCodeEngine extends OpenCodeEngine {
  private readonly scriptPath: string;

  constructor(
    script: string,
    heartbeatIntervalMs = 60_000 // disable heartbeat in most tests
  ) {
    super(heartbeatIntervalMs);
    // Windows argv does not preserve newlines, so `bun --eval <multiline>`
    // breaks (the child prints its help text). Run a temp file instead.
    this.scriptPath = join(tmpdir(), `oc-fake-${crypto.randomUUID()}.mjs`);
    writeFileSync(this.scriptPath, script);
  }

  protected override buildCommandArgs(
    _model: string,
    _workdir: string,
    _resumeSessionId?: string
  ): string[] {
    return ["bun", this.scriptPath];
  }
}

class CommandInspectingOpenCodeEngine extends OpenCodeEngine {
  getCommand(model: string, workdir: string, resumeSessionId?: string): string[] {
    return this.buildCommandArgs(model, workdir, resumeSessionId);
  }

  getStdinModeForTest(): "pipe" | "ignore" {
    return "pipe";
  }
}

async function collectAll(engine: OpenCodeEngine, workdir: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of engine.execute("test prompt", workdir, {
    runId: "test",
    litellmKey: "",
    litellmBaseUrl: "",
  })) {
    events.push(event);
  }
  return events;
}

// ─── Temp workdir ─────────────────────────────────────────────────────────────

let workdir: string;

beforeEach(async () => {
  workdir = join(tmpdir(), `opencode-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(workdir, { recursive: true });
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

// ─── humanizeStderr ───────────────────────────────────────────────────────────

describe("humanizeStderr", () => {
  it("returns null for empty lines", () => {
    expect(humanizeStderr("")).toBeNull();
    expect(humanizeStderr("   ")).toBeNull();
  });

  it("suppresses DEBUG/TRACE/INF/DBG prefixed lines", () => {
    expect(humanizeStderr("DEBUG something happened")).toBeNull();
    expect(humanizeStderr("TRACE verbose detail")).toBeNull();
    expect(humanizeStderr("INF some info")).toBeNull();
    expect(humanizeStderr("DBG debug info")).toBeNull();
  });

  it("suppresses OpenCode INFO structured log lines (all services by default)", () => {
    const line =
      "INFO  2026-03-30T21:06:05 +283ms service=default version=1.2.26 args=[...] opencode";
    expect(humanizeStderr(line)).toBeNull();
  });

  it("suppresses INFO for non-meaningful services", () => {
    expect(
      humanizeStderr("INFO  2026-03-30T21:06:06 +0ms service=permission permission=skill evaluate")
    ).toBeNull();
  });

  it("surfaces llm service INFO with modelID", () => {
    const line =
      "INFO  2026-03-30T21:06:07 +100ms service=llm modelID=opencode/minimax-m2.5-free calling";
    expect(humanizeStderr(line)).toBe("  Using model: opencode/minimax-m2.5-free");
  });

  it("passes through plain unrecognised text", () => {
    expect(humanizeStderr("something unexpected")).toBe("something unexpected");
  });

  it("suppresses JSON with debug level", () => {
    expect(humanizeStderr(JSON.stringify({ level: "debug", message: "verbose" }))).toBeNull();
  });

  it("returns message from non-debug JSON", () => {
    expect(humanizeStderr(JSON.stringify({ level: "error", message: "disk full" }))).toBe(
      "disk full"
    );
  });

  it("serializes object-shaped stderr messages instead of [object Object]", () => {
    expect(
      humanizeStderr(
        JSON.stringify({ level: "error", message: { code: "auth", text: "missing key" } })
      )
    ).toBe(JSON.stringify({ code: "auth", text: "missing key" }));
  });
});

// ─── parseLine ────────────────────────────────────────────────────────────────

describe("OpenCodeEngine.parseLine", () => {
  const engine = new FakeOpenCodeEngine("");

  it("parses a text event into a stdout log", () => {
    const events = engine.parseLine(JSON.stringify({ type: "text", part: { text: "Hello" } }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "log", stream: "stdout", content: "Hello" });
  });

  it("parses a tool_use calling event into status + log", () => {
    const events = engine.parseLine(
      JSON.stringify({
        type: "tool_use",
        part: {
          name: "read_file",
          state: { status: "calling", input: { path: "src/index.ts" } },
        },
      })
    );
    expect(events.find((e) => e.type === "status")?.content).toContain("Reading");
    expect(events.find((e) => e.type === "log" && e.stream === "stdout")?.content).toContain(
      "src/index.ts"
    );
  });

  it("parses a step_start event into Working... status", () => {
    const events = engine.parseLine(JSON.stringify({ type: "step_start", part: {} }));
    expect(events.find((e) => e.type === "status")?.content).toBe("Working...");
  });

  it("parses a thinking event into Thinking... status", () => {
    const events = engine.parseLine(
      JSON.stringify({ type: "thinking", part: { text: "reasoning" } })
    );
    expect(events.find((e) => e.type === "status")?.content).toBe("Thinking...");
  });

  it("parses an error event into a stderr log", () => {
    const events = engine.parseLine(
      JSON.stringify({ type: "error", part: { message: "model timeout" } })
    );
    expect(events[0]).toMatchObject({ type: "log", stream: "stderr", content: "model timeout" });
  });

  it("returns empty array for unknown event types (heartbeat noise)", () => {
    const events = engine.parseLine(JSON.stringify({ type: "heartbeat", part: {} }));
    expect(events).toHaveLength(0);
  });

  it("handles non-JSON plain text lines", () => {
    const events = engine.parseLine("plain text output");
    expect(events[0]).toMatchObject({
      type: "log",
      stream: "stdout",
      content: "plain text output",
    });
  });

  it("ignores lines starting with { that are invalid JSON", () => {
    expect(engine.parseLine("{broken json}")).toHaveLength(0);
  });

  it("handles JSON content containing braces and quotes correctly (brace counting)", () => {
    const trickyLine = JSON.stringify({
      type: "text",
      part: { text: 'Content with } and { and "quotes" and \\"escaped quotes\\"' },
    });
    const events = engine.parseLine(trickyLine);
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe('Content with } and { and "quotes" and \\"escaped quotes\\"');
  });

  it("surfaces tool failures with error message", () => {
    const errorLine = JSON.stringify({
      type: "tool_use",
      part: {
        name: "bash",
        state: { status: "failed", error: "Command not found" },
      },
    });
    const events = engine.parseLine(errorLine);
    expect(events.find((e) => e.stream === "stderr")?.content).toContain(
      "Error in bash: Command not found"
    );
  });

  it("handles multiple JSON objects on a single line", () => {
    const line =
      JSON.stringify({ type: "text", part: { text: "One" } }) +
      JSON.stringify({ type: "text", part: { text: "Two" } });
    const events = engine.parseLine(line);
    expect(events).toHaveLength(2);
    expect(events[0].content).toBe("One");
    expect(events[1].content).toBe("Two");
  });

  it("handles deeply nested braces and escaped quotes in strings", () => {
    const complex = {
      type: "text",
      part: { text: 'Nested { { { } } } and "escaped \\" quote" with }' },
    };
    const events = engine.parseLine(JSON.stringify(complex));
    expect(events[0].content).toContain("Nested { { { } } }");
    expect(events[0].content).toContain('\\" quote');
  });

  it("parses progress events into status + system log", () => {
    const events = engine.parseLine(
      JSON.stringify({
        type: "progress",
        part: { message: "Analyzing repo..." },
      })
    );
    expect(events.find((e) => e.type === "status")?.content).toBe("Analyzing repo...");
    expect(events.find((e) => e.type === "log" && e.stream === "system")?.content).toBe(
      "  Analyzing repo..."
    );
  });

  it("parses step_finish with token usage", () => {
    const events = engine.parseLine(
      JSON.stringify({
        type: "step_finish",
        part: { tokens: { total: 12345 } },
      })
    );
    expect(events.find((e) => e.type === "cost")?.costStats?.total_tokens).toBe(12345);
  });
  it("humanizes various tool calls correctly", () => {
    const testTools = [
      { name: "read_file", input: { path: "a.txt" }, expected: "Reading a.txt" },
      { name: "write_file", input: { file_path: "b.ts" }, expected: "Writing b.ts" },
      { name: "bash", input: { command: "ls -la" }, expected: "Running: ls -la" },
      { name: "git", input: { cmd: "commit" }, expected: "Git: commit" },
      { name: "google_search", input: { query: "bun test" }, expected: 'Searching "bun test"' },
    ];

    for (const tool of testTools) {
      const events = engine.parseLine(
        JSON.stringify({
          type: "tool_use",
          part: { name: tool.name, state: { status: "calling", input: tool.input } },
        })
      );
      const status = events.find((e) => e.type === "status")?.content;
      expect(status).toContain(tool.expected);
    }
  });

  it("humanizes tool results correctly", () => {
    const testResults = [
      { name: "read_file", output: "line1\nline2", expected: "Read 2 non-empty lines" },
      { name: "bash", output: "Success output", expected: "Success output" },
      { name: "write_file", output: "saved", expected: "File saved" },
    ];

    for (const res of testResults) {
      const events = engine.parseLine(
        JSON.stringify({
          type: "tool_use",
          part: { name: res.name, state: { status: "completed", output: res.output } },
        })
      );
      const log = events.find(
        (e) => e.type === "log" && e.stream === "stdout" && e.content?.includes(res.expected)
      )?.content;
      expect(log).toContain(res.expected);
    }
  });

  it("emits a tool label before completed tool output", () => {
    const events = engine.parseLine(
      JSON.stringify({
        type: "tool_use",
        part: {
          name: "read_file",
          state: { status: "completed", input: { path: "src/plugin.ts" }, output: "line1\nline2" },
        },
      })
    );
    expect(events.map((e) => e.content).filter(Boolean)).toEqual(
      expect.arrayContaining(["  Reading src/plugin.ts", "    Read 2 non-empty lines"])
    );
  });

  it("parses real 'text' event correctly (contract snapshot)", () => {
    const line = JSON.stringify({
      type: "text",
      part: { type: "text", text: "teste" },
    });
    const events = engine.parseLine(line);
    expect(events[0].content).toBe("teste");
  });

  it("parses real 'tool_use' (bash) event correctly (contract snapshot)", () => {
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls -la" },
          output: "total 94",
        },
      },
    });
    const events = engine.parseLine(line);
    expect(events.find((e) => e.content?.includes("total 94"))).toBeDefined();
  });

  it("parses real 'step_finish' (tokens) event correctly (contract snapshot)", () => {
    const line = JSON.stringify({
      type: "step_finish",
      part: { type: "step-finish", tokens: { total: 14570 } },
    });
    const events = engine.parseLine(line);
    expect(events.find((e) => e.type === "cost")?.costStats?.total_tokens).toBe(14570);
  });

  it("parses interactive question events correctly", () => {
    const line = JSON.stringify({
      type: "question",
      part: { text: "Are you sure?" },
    });
    const events = engine.parseLine(line);
    expect(events.find((e) => e.type === "status")?.content).toBe("Awaiting input...");
    expect(events.find((e) => e.content?.includes("?"))).toBeDefined();
  });

  it("accumulates tokens and cost cumulatively across multiple step_finish events", () => {
    const accumulators = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cached: 0,
      input_cost: 0,
      output_cost: 0,
      total_cost: 0,
    };

    // First step
    const events1 = engine.parseLine(
      JSON.stringify({
        type: "step_finish",
        part: {
          tokens: { input: 100, output: 50, total: 150 },
          cost: 0.003, // $0.003 USD = 3000 micro-dollars
        },
      }),
      accumulators
    );

    const costEvent1 = events1.find((e) => e.type === "cost")?.costStats;
    expect(costEvent1).toBeDefined();
    expect(costEvent1?.input_tokens).toBe(100);
    expect(costEvent1?.output_tokens).toBe(50);
    expect(costEvent1?.total_tokens).toBe(150);
    expect(costEvent1?.total).toBe(3000);

    // Second step
    const events2 = engine.parseLine(
      JSON.stringify({
        type: "step_finish",
        part: {
          tokens: { input: 200, output: 100, total: 300 },
          cost: 0.006, // $0.006 USD = 6000 micro-dollars
        },
      }),
      accumulators
    );

    const costEvent2 = events2.find((e) => e.type === "cost")?.costStats;
    expect(costEvent2).toBeDefined();
    // Cumulative: 100 + 200 = 300
    expect(costEvent2?.input_tokens).toBe(300);
    // Cumulative: 50 + 100 = 150
    expect(costEvent2?.output_tokens).toBe(150);
    // Cumulative: 150 + 300 = 450
    expect(costEvent2?.total_tokens).toBe(450);
    // Cumulative: 3000 + 6000 = 9000
    expect(costEvent2?.total).toBe(9000);
  });
});

describe("OpenCodeEngine.buildCommand", () => {
  it("passes correct base arguments without prompt (prompt sent via stdin)", () => {
    const engine = new CommandInspectingOpenCodeEngine();
    const command = engine.getCommand("opencode/minimax-m2.5-free", "/tmp/workdir");

    // command[0] may be "opencode" on POSIX or the resolved native exe on Windows
    expect(command[0]).toMatch(/opencode(\.exe|\.cmd)?$/i);
    expect(command.slice(1)).toEqual([
      "run",
      "--format",
      "json",
      "--model",
      "opencode/minimax-m2.5-free",
      "--dir",
      "/tmp/workdir",
    ]);
    expect(command).not.toContain("--file");
    expect(command).not.toContain("--prompt");
  });

  it("includes --session when resumeSessionId is provided", () => {
    const engine = new CommandInspectingOpenCodeEngine();
    const command = engine.getCommand("opencode/minimax-m2.5-free", "/tmp/workdir", "session-123");

    expect(command).toContain("--session");
    expect(command).toContain("session-123");
  });

  it("uses pipe stdin mode on all platforms (stdin is closed immediately on Windows)", () => {
    const engine = new CommandInspectingOpenCodeEngine();
    expect(engine.getStdinModeForTest()).toBe("pipe");
  });
});

// ─── execute: opencode.json lifecycle ─────────────────────────────────────────

describe("execute: opencode.json lifecycle", () => {
  it("creates opencode.json in isolated directory and configures XDG_CONFIG_HOME", async () => {
    const engine = new FakeOpenCodeEngine(
      `
      const fs = require("node:fs");
      const path = require("node:path");
      const xdgConfigHome = process.env.XDG_CONFIG_HOME;
      const disableProj = process.env.OPENCODE_DISABLE_PROJECT_CONFIG;
      const configPath = xdgConfigHome ? path.join(xdgConfigHome, "opencode", "opencode.json") : "";
      const exists = configPath && fs.existsSync(configPath);
      let config = {};
      if (exists) {
        try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch {}
      }
      const payload = JSON.stringify({
        type: "text",
        part: {
          text: "CONFIG_EXISTS:exists=" + exists + ";disableProj=" + disableProj + ";config=" + JSON.stringify(config) + ";xdg=" + xdgConfigHome
        }
      });
      process.stdout.write(payload + "\\n");
      `
    );

    const events = await collectAll(engine, workdir);
    const textEvent = events.find(
      (e) => e.type === "log" && e.stream === "stdout" && e.content?.startsWith("CONFIG_EXISTS")
    );
    expect(textEvent).toBeDefined();
    expect(textEvent?.content).toContain("exists=true");
    expect(textEvent?.content).toContain("disableProj=true");
    expect(textEvent?.content).toContain('"*"');
    expect(textEvent?.content).toContain('"allow"');
  }, 10_000);

  it("deletes the isolated config directory and leaves workspace clean after execution", async () => {
    const engine = new FakeOpenCodeEngine(
      `
      const payload = JSON.stringify({
        type: "text",
        part: {
          text: "XDG_PATH:" + process.env.XDG_CONFIG_HOME
        }
      });
      process.stdout.write(payload + "\\n");
      `
    );
    const events = await collectAll(engine, workdir);
    const xdgEvent = events.find(
      (e) => e.type === "log" && e.stream === "stdout" && e.content?.startsWith("XDG_PATH:")
    );
    expect(xdgEvent).toBeDefined();
    const xdgPath = xdgEvent?.content?.substring("XDG_PATH:".length);
    expect(xdgPath).toBeTruthy();

    // Verify workspace file does not exist
    const workspaceConfigExists = await Bun.file(join(workdir, "opencode.json")).exists();
    expect(workspaceConfigExists).toBe(false);

    // Verify temp isolated directory was deleted
    const fs = require("node:fs");
    expect(fs.existsSync(xdgPath)).toBe(false);
  }, 10_000);
});

// ─── execute: complete event ───────────────────────────────────────────────────

describe("execute: complete event", () => {
  it("always emits a complete event as the last event", async () => {
    const engine = new FakeOpenCodeEngine("// no-op");
    const events = await collectAll(engine, workdir);
    expect(events[events.length - 1].type).toBe("complete");
  }, 10_000);

  it("complete event has exitCode 0 for a successful process", async () => {
    const engine = new FakeOpenCodeEngine("process.exit(0)");
    const events = await collectAll(engine, workdir);
    expect(events.find((e) => e.type === "complete")?.exitCode).toBe(0);
  }, 10_000);

  it("complete event carries correct non-zero exitCode", async () => {
    const engine = new FakeOpenCodeEngine("process.exit(3)");
    const events = await collectAll(engine, workdir);
    expect(events.find((e) => e.type === "complete")?.exitCode).toBe(3);
  }, 10_000);

  it("emits a stderr log for non-zero exit", async () => {
    const engine = new FakeOpenCodeEngine("process.exit(1)");
    const events = await collectAll(engine, workdir);
    const exitLog = events.find(
      (e) => e.type === "log" && e.stream === "stderr" && e.content?.includes("Exited with code 1")
    );
    expect(exitLog).toBeDefined();
  }, 10_000);

  it("does NOT emit exit log for exit code 0", async () => {
    const engine = new FakeOpenCodeEngine("process.exit(0)");
    const events = await collectAll(engine, workdir);
    expect(
      events.find(
        (e) => e.type === "log" && e.stream === "stderr" && e.content?.includes("Exited with code")
      )
    ).toBeUndefined();
  }, 10_000);
});

// ─── execute: real-time streaming (THE CRITICAL TEST) ─────────────────────────

describe("execute: real-time streaming", () => {
  it("yields stdout events BEFORE the process exits", async () => {
    // Script writes an event, waits 400ms, then exits.
    // Events must be received before the 400ms wait is over.
    const script = `
      const e = JSON.stringify({type:"text", part:{text:"live-event"}});
      process.stdout.write(e + "\\n");
      await new Promise(r => setTimeout(r, 400));
    `;

    const engine = new FakeOpenCodeEngine(script);
    const arrivals: { content: string; ms: number }[] = [];
    const start = Date.now();
    let completeMs = 0;

    for await (const event of engine.execute("test", workdir, {
      runId: "test",
      litellmKey: "",
      litellmBaseUrl: "",
    })) {
      const ms = Date.now() - start;
      if (event.type === "log" && event.stream === "stdout" && event.content === "live-event") {
        arrivals.push({ content: event.content, ms });
      }
      if (event.type === "complete") {
        completeMs = ms;
        break;
      }
    }

    // Must have received the event
    expect(arrivals).toHaveLength(1);
    // The event must arrive before the process finishes (completeMs ≈ 400ms).
    // Real-time streaming means it arrives well before completion.
    expect(arrivals[0].ms).toBeLessThan(completeMs);
  }, 10_000);

  it("yields multiple events incrementally during execution", async () => {
    const script = `
      const write = (n) => process.stdout.write(
        JSON.stringify({type:"text", part:{text:"event-" + n}}) + "\\n"
      );
      write(1);
      await new Promise(r => setTimeout(r, 100));
      write(2);
      await new Promise(r => setTimeout(r, 100));
      write(3);
    `;

    const engine = new FakeOpenCodeEngine(script);
    const textEvents: string[] = [];

    for await (const event of engine.execute("test", workdir, {
      runId: "test",
      litellmKey: "",
      litellmBaseUrl: "",
    })) {
      if (
        event.type === "log" &&
        event.stream === "stdout" &&
        event.content?.startsWith("event-")
      ) {
        textEvents.push(event.content);
      }
      if (event.type === "complete") break;
    }

    expect(textEvents).toEqual(["event-1", "event-2", "event-3"]);
  }, 10_000);

  it("does not duplicate events (each event appears exactly once)", async () => {
    const script = `
      process.stdout.write(JSON.stringify({type:"text", part:{text:"once"}}) + "\\n");
      await new Promise(r => setTimeout(r, 50));
    `;

    const engine = new FakeOpenCodeEngine(script);
    const events = await collectAll(engine, workdir);
    const count = events.filter((e) => e.type === "log" && e.content === "once").length;
    expect(count).toBe(1);
  }, 10_000);

  it("delivers events written right before process exits", async () => {
    // No delay — process exits immediately after writing.
    const script = `
      process.stdout.write(JSON.stringify({type:"text", part:{text:"last-breath"}}) + "\\n");
    `;

    const engine = new FakeOpenCodeEngine(script);
    const events = await collectAll(engine, workdir);
    expect(events.find((e) => e.type === "log" && e.content === "last-breath")).toBeDefined();
  }, 10_000);
});

// ─── execute: stderr passthrough ─────────────────────────────────────────────

describe("execute: stderr passthrough", () => {
  it("surfaces plain text stderr lines", async () => {
    const engine = new FakeOpenCodeEngine(`process.stderr.write("something went wrong\\n")`);
    const events = await collectAll(engine, workdir);
    expect(
      events.find(
        (e) => e.type === "log" && e.stream === "stderr" && e.content === "something went wrong"
      )
    ).toBeDefined();
  }, 10_000);

  it("suppresses OpenCode INFO structured log lines from stderr", async () => {
    const noisyLine = "INFO  2026-03-30T21:06:05 +283ms service=default version=1.2.26 opencode";
    const engine = new FakeOpenCodeEngine(
      `process.stderr.write(${JSON.stringify(`${noisyLine}\\n`)})`
    );
    const events = await collectAll(engine, workdir);
    expect(
      events.filter(
        (e) => e.type === "log" && e.stream === "stderr" && e.content?.includes("service=default")
      )
    ).toHaveLength(0);
  }, 10_000);
});

// ─── execute: abort signal ────────────────────────────────────────────────────

describe("execute: abort signal", () => {
  it("resolves (does not hang) when the signal is aborted", async () => {
    const controller = new AbortController();
    const engine = new FakeOpenCodeEngine(`setInterval(() => {}, 10_000)`);

    const done = (async () => {
      const events: AgentEvent[] = [];
      for await (const event of engine.execute("test", workdir, {
        runId: "test-abort",
        signal: controller.signal,
        litellmKey: "",
        litellmBaseUrl: "",
      })) {
        events.push(event);
      }
      return events;
    })();

    setTimeout(() => controller.abort(), 50);

    const events = await done;
    expect(Array.isArray(events)).toBe(true);
  }, 10_000);
});

// ─── execute: heartbeat ───────────────────────────────────────────────────────

describe("execute: heartbeat", () => {
  it("emits a 'Still running' system log during a long process", async () => {
    // Process waits 300ms; heartbeat interval = 100ms → at least one heartbeat fires.
    const script = `await new Promise(r => setTimeout(r, 300))`;
    const engine = new FakeOpenCodeEngine(script, 100 /* heartbeatIntervalMs */);
    const events = await collectAll(engine, workdir);
    const heartbeats = events.filter(
      (e) => e.type === "log" && e.stream === "system" && e.content?.includes("Still running")
    );
    expect(heartbeats.length).toBeGreaterThanOrEqual(1);
  }, 10_000);
});

// ─── execute: auto-free selection ──────────────────────────────────────────────

describe("OpenCodeEngine auto-free selection", () => {
  it("selects a free model from listing", async () => {
    const originalSpawn = Bun.spawn;
    try {
      Bun.spawn = mock((cmd: string[], options?: any) => {
        if (cmd[0].endsWith("opencode") || cmd[0].includes("opencode") || cmd[1] === "models") {
          return {
            exited: Promise.resolve(),
            exitCode: 0,
            stdout: new Response("opencode/model-a-free\nopencode/model-b-premium\n").body,
          } as any;
        }
        return originalSpawn(cmd, options);
      }) as any;

      const engine = new OpenCodeEngine();
      const model = await engine.selectFreeModel();
      expect(model).toBe("opencode/model-a-free");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  it("falls back to auto-free on command error", async () => {
    const originalSpawn = Bun.spawn;
    try {
      Bun.spawn = mock((cmd: string[], options?: any) => {
        if (cmd[0].endsWith("opencode") || cmd[0].includes("opencode") || cmd[1] === "models") {
          return {
            exited: Promise.resolve(),
            exitCode: 1,
            stdout: new Response("").body,
          } as any;
        }
        return originalSpawn(cmd, options);
      }) as any;

      const engine = new OpenCodeEngine();
      const model = await engine.selectFreeModel();
      expect(model).toBe(DEFAULT_OPENCODE_MODEL);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });
});

describe("OpenCodeEngine model listing", () => {
  it("returns fallback models when external providers list nothing", async () => {
    const originalSpawn = Bun.spawn;
    try {
      Bun.spawn = mock((cmd: string[], options?: any) => {
        if (cmd[0].endsWith("opencode") || cmd[0].includes("opencode") || cmd[1] === "models") {
          return {
            exited: Promise.resolve(),
            exitCode: 1,
            stdout: new Response("").body,
            stderr: new Response("").body,
          } as any;
        }
        return originalSpawn(cmd, options);
      }) as any;

      const engine = new OpenCodeEngine();
      const models = await engine.listModels();
      expect(models).toContain(DEFAULT_OPENCODE_MODEL);
      expect(models).toContain("auto-free");
      expect(models.length).toBeGreaterThan(0);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });
});

describe("OpenCodeEngine MCP configuration", () => {
  it("serializes options.mcpServers into opencode.json", async () => {
    const scriptPath = join(workdir, "inspect-mcp.js");
    await Bun.write(
      scriptPath,
      `const fs = require('node:fs');
       const path = require('node:path');
       const configPath = path.join(process.env.XDG_CONFIG_HOME, 'opencode', 'opencode.json');
       const content = fs.readFileSync(configPath, 'utf8').replace(/\\n/g, ' ');
       console.log(JSON.stringify({ type: 'text', part: { text: 'MCP_CONFIG:' + content } }));`
    );

    class ScriptFileOpenCodeEngine extends OpenCodeEngine {
      protected override buildCommandArgs(
        _model: string,
        _workdir: string,
        _resumeSessionId?: string
      ): string[] {
        return ["bun", scriptPath];
      }
    }

    const engine = new ScriptFileOpenCodeEngine();

    const mcpServers = {
      github: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-github"],
        enabled: true,
        environment: {
          GITHUB_PERSONAL_ACCESS_TOKEN: "test_token",
        },
      },
    };

    const events: AgentEvent[] = [];
    for await (const event of engine.execute("test", workdir, {
      runId: "test",
      litellmKey: "",
      litellmBaseUrl: "",
      mcpServers,
    })) {
      events.push(event);
    }
    const logEvent = events.find(
      (e) => e.type === "log" && e.stream === "stdout" && e.content?.startsWith("MCP_CONFIG:")
    );
    expect(logEvent).toBeDefined();
    const rawJson = logEvent?.content?.slice("MCP_CONFIG:".length) ?? "{}";
    const config = JSON.parse(rawJson);
    expect(config.mcp).toBeDefined();
    expect(config.mcp.github).toEqual(mcpServers.github);
  });
});
