import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "./engine";
import { streamProcess } from "./stream-process";

type SpawnedProc = Parameters<typeof streamProcess>[0];

async function collect(
  proc: SpawnedProc,
  parseLine: (line: string) => AgentEvent[],
  signal?: AbortSignal
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of streamProcess(proc, parseLine, signal)) {
    events.push(event);
  }
  return events;
}

function passthrough(line: string): AgentEvent[] {
  return [{ type: "log", stream: "stdout", content: line }];
}

function spawn(code: string) {
  return Bun.spawn(["bun", "-e", code], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
}

describe("streamProcess", () => {
  describe("stdout streaming", () => {
    it("yields stdout lines as log events", async () => {
      const proc = spawn(`console.log("hello"); console.log("world")`);
      const events = await collect(proc, passthrough);
      const logs = events.filter((e) => e.type === "log" && e.stream === "stdout");
      expect(logs.map((e) => e.content)).toContain("hello");
      expect(logs.map((e) => e.content)).toContain("world");
    });

    it("streams carriage-return progress lines in real time", async () => {
      const proc = spawn(`
        process.stdout.write("Progress 10%\\r");
        process.stdout.write("Progress 50%\\r");
        process.stdout.write("Progress 100%\\n");
      `);
      const events = await collect(proc, passthrough);
      const logs = events
        .filter((e) => e.type === "log" && e.stream === "stdout")
        .map((e) => e.content);

      expect(logs).toContain("Progress 10%");
      expect(logs).toContain("Progress 50%");
      expect(logs).toContain("Progress 100%");
    });

    it("does not emit empty lines", async () => {
      const proc = spawn(`console.log("a"); console.log(""); console.log("b")`);
      const events = await collect(proc, passthrough);
      const emptyLogs = events.filter(
        (e) => e.type === "log" && e.stream === "stdout" && e.content === ""
      );
      expect(emptyLogs.length).toBe(0);
    });
  });

  describe("stderr streaming", () => {
    it("yields stderr lines as stderr log events", async () => {
      const proc = spawn(`process.stderr.write("err line\\n")`);
      const events = await collect(proc, passthrough);
      const stderrLogs = events.filter((e) => e.type === "log" && e.stream === "stderr");
      expect(stderrLogs.length).toBeGreaterThan(0);
      expect(stderrLogs[0].content).toBe("err line");
    });
  });

  describe("exit code handling — critical bug fix", () => {
    it("does NOT yield type:error for non-zero exit code", async () => {
      const proc = spawn(`process.exit(1)`);
      const events = await collect(proc, passthrough);
      const errorEvents = events.filter((e) => e.type === "error");
      expect(errorEvents.length).toBe(0);
    });

    it("yields type:log stream:stderr with exit message for non-zero exit", async () => {
      const proc = spawn(`process.exit(2)`);
      const events = await collect(proc, passthrough);
      const exitLog = events.find(
        (e) =>
          e.type === "log" && e.stream === "stderr" && e.content?.includes("Exited with code 2")
      );
      expect(exitLog).toBeDefined();
    });

    it("does NOT yield exit error log for exit code 0", async () => {
      const proc = spawn(`process.exit(0)`);
      const events = await collect(proc, passthrough);
      const exitLog = events.find(
        (e) => e.type === "log" && e.stream === "stderr" && e.content?.includes("Exited with code")
      );
      expect(exitLog).toBeUndefined();
    });
  });

  describe("complete event", () => {
    it("yields type:complete with exitCode 0 on success", async () => {
      const proc = spawn(`process.exit(0)`);
      const events = await collect(proc, () => []);
      const complete = events.find((e) => e.type === "complete");
      expect(complete).toBeDefined();
      expect(complete?.exitCode).toBe(0);
    });

    it("yields type:complete with correct exit code for non-zero", async () => {
      const proc = spawn(`process.exit(42)`);
      const events = await collect(proc, () => []);
      const complete = events.find((e) => e.type === "complete");
      expect(complete?.exitCode).toBe(42);
    });

    it("always yields complete even when process writes output then fails", async () => {
      const proc = spawn(`console.log("done"); process.exit(1)`);
      const events = await collect(proc, passthrough);
      const complete = events.find((e) => e.type === "complete");
      expect(complete).toBeDefined();
    });
  });

  describe("parseLine callback", () => {
    it("applies parseLine transformer to stdout lines", async () => {
      const proc = spawn(`console.log('{"type":"assistant"}')`);
      const events = await collect(proc, (line) => {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "assistant") {
            return [{ type: "status", content: "Agent responded" }];
          }
        } catch {}
        return [{ type: "log", stream: "stdout", content: line }];
      });
      const status = events.find((e) => e.type === "status" && e.content === "Agent responded");
      expect(status).toBeDefined();
    });

    it("parseLine returning empty array produces no events for that line", async () => {
      const proc = spawn(`console.log("ignored line")`);
      const events = await collect(proc, () => []);
      const logEvents = events.filter((e) => e.type === "log" && e.stream === "stdout");
      expect(logEvents.length).toBe(0);
    });
  });

  describe("abort signal", () => {
    it("stops streaming when aborted", async () => {
      const controller = new AbortController();
      const proc = spawn(`setInterval(() => {}, 10000)`);
      const collectPromise = collect(proc, passthrough, controller.signal);
      setTimeout(() => controller.abort(), 20);
      const events = await collectPromise;
      // Should resolve (not hang) after abort
      expect(Array.isArray(events)).toBe(true);
    });
  });
});
