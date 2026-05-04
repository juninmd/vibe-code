import { describe, expect, it, mock } from "bun:test";
import { withHeartbeat, getHeartbeatIntervalMs } from "./heartbeat";
import type { AgentEvent } from "../engine";

describe("heartbeat", () => {
  describe("getHeartbeatIntervalMs", () => {
    it("returns default 30000 when env not set", () => {
      const old = process.env.VIBE_CODE_HEARTBEAT_MS;
      delete process.env.VIBE_CODE_HEARTBEAT_MS;
      expect(getHeartbeatIntervalMs()).toBe(30_000);
      if (old !== undefined) process.env.VIBE_CODE_HEARTBEAT_MS = old;
    });

    it("returns env value if set", () => {
      const old = process.env.VIBE_CODE_HEARTBEAT_MS;
      process.env.VIBE_CODE_HEARTBEAT_MS = "5000";
      expect(getHeartbeatIntervalMs()).toBe(5000);
      if (old !== undefined) {
        process.env.VIBE_CODE_HEARTBEAT_MS = old;
      } else {
        delete process.env.VIBE_CODE_HEARTBEAT_MS;
      }
    });
  });

  describe("withHeartbeat", () => {
    it("yields events without heartbeat if they arrive quickly", async () => {
      async function* source(): AsyncGenerator<AgentEvent> {
        yield { type: "log", content: "hello" };
        yield { type: "log", content: "world" };
      }

      const events: AgentEvent[] = [];
      for await (const ev of withHeartbeat(source(), 1000)) {
        events.push(ev);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "log", content: "hello" });
      expect(events[1]).toEqual({ type: "log", content: "world" });
    });

    it("yields heartbeat if events are delayed", async () => {
      async function* source(): AsyncGenerator<AgentEvent> {
        yield { type: "log", content: "first" };
        await new Promise((r) => setTimeout(r, 150));
        yield { type: "log", content: "second" };
      }

      const events: AgentEvent[] = [];
      for await (const ev of withHeartbeat(source(), 50)) {
        events.push(ev);
      }

      // Should have at least one heartbeat
      const heartbeats = events.filter((e) => e.type === "log" && e.stream === "system" && e.content?.includes("Still running"));
      expect(heartbeats.length).toBeGreaterThan(0);

      const normalLogs = events.filter((e) => e.content === "first" || e.content === "second");
      expect(normalLogs).toHaveLength(2);
    });

    it("stops when source finishes", async () => {
      async function* source(): AsyncGenerator<AgentEvent> {
        yield { type: "log", content: "done" };
      }

      const events: AgentEvent[] = [];
      for await (const ev of withHeartbeat(source(), 50)) {
        events.push(ev);
      }

      expect(events).toHaveLength(1);
    });

    it("aborts when signal is aborted", async () => {
      const ac = new AbortController();
      async function* source(): AsyncGenerator<AgentEvent> {
        yield { type: "log", content: "first" };
        await new Promise((r) => setTimeout(r, 200));
        yield { type: "log", content: "never" };
      }

      const gen = withHeartbeat(source(), 50, ac.signal);

      const events: AgentEvent[] = [];
      setTimeout(() => ac.abort(), 100);

      for await (const ev of gen) {
        events.push(ev);
      }

      expect(events.some(e => e.content === "first")).toBe(true);
      expect(events.some(e => e.content === "never")).toBe(false);
    });
  });
});
