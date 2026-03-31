import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AgentEvent } from "../engine";
import { OpenCodeEngine, humanizeStderr } from "./opencode";

// ─── Test helper ──────────────────────────────────────────────────────────────
// Replaces the opencode CLI with an inline Bun script for deterministic tests.

class FakeOpenCodeEngine extends OpenCodeEngine {
  constructor(
    private readonly script: string,
    heartbeatIntervalMs = 60_000 // disable heartbeat in most tests
  ) {
    super(heartbeatIntervalMs);
  }

  protected override buildCommand(_model: string, _prompt: string): string[] {
    return ["bun", "-e", this.script];
  }
}

async function collectAll(engine: OpenCodeEngine, workdir: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of engine.execute("test prompt", workdir)) {
    events.push(event);
  }
  return events;
}

// ─── Temp workdir ─────────────────────────────────────────────────────────────

let workdir: string;

beforeEach(async () => {
  workdir = join(
    tmpdir(),
    `opencode-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
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
      humanizeStderr(
        "INFO  2026-03-30T21:06:06 +0ms service=permission permission=skill evaluate"
      )
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
    expect(
      events.find((e) => e.type === "log" && e.stream === "stdout")?.content
    ).toContain("src/index.ts");
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
      part: { text: 'Content with } and { and "quotes" and \\"escaped quotes\\"' }
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
        state: { status: "failed", error: "Command not found" }
      }
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
      expect(events[0].content).toMatch(/tokens used: 12[.,]345/);
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
      { name: "read_file", output: "line1\nline2", expected: "2 lines read" },
      { name: "bash", output: "Success output", expected: "Success output" },
      { name: "write_file", output: "saved", expected: "Saved" },
    ];

    for (const res of testResults) {
      const events = engine.parseLine(
        JSON.stringify({
          type: "tool_use",
          part: { name: res.name, state: { status: "completed", output: res.output } },
        })
      );
      const log = events.find((e) => e.type === "log" && e.stream === "stdout")?.content;
      expect(log).toContain(res.expected);
    }
  });

  it("parses real 'text' event correctly (contract snapshot)", () => {
    const line = JSON.stringify({
      type: "text",
      part: { type: "text", text: "teste" }
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
          output: "total 94"
        }
      }
    });
    const events = engine.parseLine(line);
    expect(events.find(e => e.content?.includes("total 94"))).toBeDefined();
  });

  it("parses real 'step_finish' (tokens) event correctly (contract snapshot)", () => {
    const line = JSON.stringify({
      type: "step_finish",
      part: { type: "step-finish", tokens: { total: 14570 } }
    });
    const events = engine.parseLine(line);
    expect(events.find(e => e.content?.match(/tokens used: 14[.,]570/))).toBeDefined();
  });

  it("parses interactive question events correctly", () => {
    const line = JSON.stringify({
      type: "question",
      part: { text: "Are you sure?" }
    });
    const events = engine.parseLine(line);
    expect(events.find(e => e.type === "status")?.content).toBe("Awaiting input...");
    expect(events.find(e => e.content?.includes("Question"))).toBeDefined();
  });
});

// ─── execute: opencode.json lifecycle ─────────────────────────────────────────

describe("execute: opencode.json lifecycle", () => {
  it("creates opencode.json with permission *:allow before running the subprocess", async () => {
    // The script checks if opencode.json exists and emits a JSON event with the result.
    const engine = new FakeOpenCodeEngine(
      `
      const fs = require("node:fs");
      const exists = fs.existsSync(process.cwd() + "/opencode.json");
      let config = {};
      if (exists) {
        try { config = JSON.parse(fs.readFileSync(process.cwd() + "/opencode.json", "utf8")); } catch {}
      }
      const payload = JSON.stringify({type:"text", part:{text: exists ? "CONFIG_EXISTS:" + JSON.stringify(config) : "CONFIG_MISSING"}});
      process.stdout.write(payload + "\\n");
      `
    );

    const events = await collectAll(engine, workdir);
    const textEvent = events.find(
      (e) => e.type === "log" && e.stream === "stdout" && e.content?.startsWith("CONFIG_EXISTS")
    );
    expect(textEvent).toBeDefined();
    expect(textEvent!.content).toContain('"*"');
    expect(textEvent!.content).toContain('"allow"');
  }, 10_000);

  it("deletes opencode.json after execution completes", async () => {
    const engine = new FakeOpenCodeEngine("// no-op");
    await collectAll(engine, workdir);

    const exists = await Bun.file(join(workdir, "opencode.json")).exists();
    expect(exists).toBe(false);
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
      (e) =>
        e.type === "log" &&
        e.stream === "stderr" &&
        e.content?.includes("Exited with code 1")
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

    for await (const event of engine.execute("test", workdir)) {
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

    for await (const event of engine.execute("test", workdir)) {
      if (event.type === "log" && event.stream === "stdout" && event.content?.startsWith("event-")) {
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
    const engine = new FakeOpenCodeEngine(
      `process.stderr.write("something went wrong\\n")`
    );
    const events = await collectAll(engine, workdir);
    expect(
      events.find((e) => e.type === "log" && e.stream === "stderr" && e.content === "something went wrong")
    ).toBeDefined();
  }, 10_000);

  it("suppresses OpenCode INFO structured log lines from stderr", async () => {
    const noisyLine =
      "INFO  2026-03-30T21:06:05 +283ms service=default version=1.2.26 opencode";
    const engine = new FakeOpenCodeEngine(
      `process.stderr.write(${JSON.stringify(noisyLine + "\\n")})`
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
