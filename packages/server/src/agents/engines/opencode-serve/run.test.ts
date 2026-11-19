import { describe, expect, it } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "../../engine";
import { OpenCodeEngine } from "../opencode";
import type { ServeHandle } from "./process";
import { runServeTurn, type ServeTurnInput } from "./run";

const SID = "ses_fake";

interface FakeOptions {
  events?: Array<Record<string, unknown>>;
  missingSession?: boolean;
  hang?: boolean;
}

function fakeClient(options: FakeOptions) {
  const calls: Record<string, unknown[]> = { prompt: [], reply: [], reject: [], abort: [] };
  let release: () => void = () => {};
  const client = {
    session: {
      get: async () =>
        options.missingSession ? { error: { name: "NotFound" } } : { data: { id: SID } },
      create: async () => ({ data: { id: SID } }),
      promptAsync: async (body: unknown) => {
        calls.prompt.push(body);
        return { data: undefined };
      },
      abort: async (body: unknown) => {
        calls.abort.push(body);
        release();
        return { data: true };
      },
    },
    permission: { reply: async (body: unknown) => calls.reply.push(body) },
    question: { reject: async (body: unknown) => calls.reject.push(body) },
    event: {
      subscribe: async (_params: unknown, opts: { signal: AbortSignal }) => ({
        stream: (async function* () {
          for (const event of options.events ?? []) yield event;
          if (options.hang) {
            await new Promise<void>((resolve) => {
              release = resolve;
              opts.signal.addEventListener("abort", () => resolve());
            });
          }
        })(),
      }),
    },
  };
  return { client: client as unknown as OpencodeClient, calls };
}

function input(fake: ReturnType<typeof fakeClient>, extra: Partial<ServeTurnInput> = {}) {
  let closed = false;
  const server: ServeHandle = {
    url: "http://127.0.0.1:1",
    authorization: "Basic x",
    exited: Promise.resolve(0),
    close: () => {
      closed = true;
    },
  };
  const engine = new OpenCodeEngine(60_000);
  return {
    isClosed: () => closed,
    value: {
      prompt: "faça",
      workdir: "/tmp/w",
      binary: "opencode",
      env: {},
      model: "opencode/big-pickle",
      parse: (line: Record<string, unknown>) => engine.parseLine(JSON.stringify(line)),
      start: async () => server,
      connect: () => fake.client,
      ...extra,
    } satisfies ServeTurnInput,
  };
}

async function collect(gen: AsyncGenerator<AgentEvent>) {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const textDone = {
  type: "message.part.updated",
  properties: {
    sessionID: SID,
    part: { id: "p1", type: "text", text: "Pronto.", time: { start: 1, end: 2 } },
  },
};
const writeDone = {
  type: "message.part.updated",
  properties: {
    sessionID: SID,
    part: {
      id: "p2",
      type: "tool",
      tool: "write",
      state: { status: "completed", input: { filePath: "a.txt" }, output: "ok" },
    },
  },
};
const idle = { type: "session.idle", properties: { sessionID: SID } };

describe("runServeTurn", () => {
  it("streams the turn through the run parser and stops the server when idle", async () => {
    const fake = fakeClient({ events: [writeDone, textDone, idle] });
    const turn = input(fake);
    const events = await collect(runServeTurn(turn.value));
    expect(events[0]).toEqual({ type: "session", sessionId: SID });
    const stdout = events.filter((e) => e.stream === "stdout").map((e) => e.content);
    expect(stdout).toContain("Pronto.");
    expect(stdout.some((line) => line?.includes("a.txt"))).toBe(true);
    expect(events.at(-1)).toEqual({ type: "complete", exitCode: 0 });
    expect(fake.calls.prompt[0]).toMatchObject({
      sessionID: SID,
      model: { providerID: "opencode", modelID: "big-pickle" },
      parts: [{ type: "text", text: "faça" }],
    });
    expect(turn.isClosed()).toBe(true);
  });

  it("fails instead of silently starting over when the resumed session is gone", async () => {
    const fake = fakeClient({ missingSession: true });
    const events = await collect(runServeTurn(input(fake, { resumeSessionId: "ses_old" }).value));
    expect(events.some((e) => e.type === "error" && e.content?.includes("ses_old"))).toBe(true);
    expect(events.at(-1)).toEqual({ type: "complete", exitCode: 1 });
    expect(fake.calls.prompt).toHaveLength(0);
  });

  it("answers permission asks with the decision and rejects questions so the turn never hangs", async () => {
    const ask = {
      type: "permission.asked",
      properties: {
        id: "per_1",
        sessionID: SID,
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
      },
    };
    const question = {
      type: "question.asked",
      properties: { id: "q_1", sessionID: SID, questions: [{ question: "Qual?" }] },
    };
    const fake = fakeClient({ events: [ask, question, idle] });
    const events = await collect(runServeTurn(input(fake).value));
    await Bun.sleep(0);
    expect(fake.calls.reply).toEqual([{ requestID: "per_1", reply: "once" }]);
    expect(fake.calls.reject).toEqual([{ requestID: "q_1" }]);
    expect(events.some((e) => e.content?.includes("question skipped: Qual?"))).toBe(true);
  });

  it("marks the turn failed on a session error", async () => {
    const error = {
      type: "session.error",
      properties: { sessionID: SID, error: { name: "APIError", data: { message: "bad key" } } },
    };
    const events = await collect(runServeTurn(input(fakeClient({ events: [error] })).value));
    expect(events.some((e) => e.type === "error" && e.content === "bad key")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "complete", exitCode: 1 });
  });

  it("aborts the OpenCode session when the run is stopped", async () => {
    const fake = fakeClient({ hang: true });
    const controller = new AbortController();
    const done = collect(runServeTurn(input(fake, { signal: controller.signal }).value));
    await Bun.sleep(10);
    controller.abort();
    const events = await done;
    expect(fake.calls.abort).toEqual([{ sessionID: SID }]);
    expect(events.at(-1)).toEqual({ type: "complete", exitCode: 130 });
  });

  it("reports a server that cannot start", async () => {
    const fake = fakeClient({});
    const events = await collect(
      runServeTurn(
        input(fake, {
          start: async () => {
            throw new Error("opencode serve exited before listening: boom");
          },
        }).value
      )
    );
    expect(events.some((e) => e.content?.includes("boom"))).toBe(true);
    expect(events.at(-1)).toEqual({ type: "complete", exitCode: 1 });
  });
});
