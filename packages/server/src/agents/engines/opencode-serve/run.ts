import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "../../engine";
import {
  type MappedEvent,
  type PermissionAsk,
  promptModel,
  type ServeEvent,
  ServeEventMapper,
} from "./events";
import { type ServeHandle, type StartServeOptions, startOpencodeServe } from "./process";

export type PermissionReply = "once" | "always" | "reject";

export interface ServeTurnInput {
  prompt: string;
  workdir: string;
  binary: string;
  env: Record<string, string | undefined>;
  model?: string;
  resumeSessionId?: string;
  signal?: AbortSignal;
  /** Parses a `run --format json` line (the engine's existing parser). */
  parse: (line: Record<string, unknown>) => AgentEvent[];
  /** Decides a permission request; the default keeps the non-interactive "allow" contract. */
  decide?: (request: PermissionAsk) => Promise<PermissionReply>;
  start?: (options: StartServeOptions) => Promise<ServeHandle>;
  connect?: (server: ServeHandle, workdir: string) => OpencodeClient;
}

const allowOnce = async (): Promise<PermissionReply> => "once";

function connectClient(server: ServeHandle, workdir: string): OpencodeClient {
  return createOpencodeClient({
    baseUrl: server.url,
    directory: workdir,
    headers: { authorization: server.authorization },
  });
}

async function openSession(client: OpencodeClient, resume?: string): Promise<string> {
  if (resume) {
    const found = await client.session.get({ sessionID: resume });
    if (found.error || !found.data) throw new Error(`OpenCode session ${resume} was not found`);
    return resume;
  }
  const created = await client.session.create({});
  if (created.error || !created.data) throw new Error("OpenCode did not create a session");
  return created.data.id;
}

/** One conversational turn over `opencode serve`: prompt, stream until idle, then stop the server. */
export async function* runServeTurn(input: ServeTurnInput): AsyncGenerator<AgentEvent> {
  const decide = input.decide ?? allowOnce;
  const events = new AbortController();
  let server: ServeHandle | undefined;
  let client: OpencodeClient | undefined;
  let sessionID: string | undefined;
  let exitCode = 0;
  const onAbort = () => {
    if (client && sessionID) void client.session.abort({ sessionID }).catch(() => {});
    events.abort();
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    server = await (input.start ?? startOpencodeServe)({
      binary: input.binary,
      cwd: input.workdir,
      env: input.env,
    });
    client = (input.connect ?? connectClient)(server, input.workdir);
    sessionID = await openSession(client, input.resumeSessionId);
    yield { type: "session", sessionId: sessionID };
    yield { type: "log", stream: "system", content: `[opencode] serve session ${sessionID}` };

    const subscription = await client.event.subscribe(undefined, {
      signal: events.signal,
      sseMaxRetryAttempts: 3,
    });
    const sent = await client.session.promptAsync({
      sessionID,
      ...promptModel(input.model),
      parts: [{ type: "text", text: input.prompt }],
    });
    if (sent.error) throw new Error(`OpenCode rejected the prompt: ${JSON.stringify(sent.error)}`);

    const mapper = new ServeEventMapper(sessionID);
    stream: for await (const raw of subscription.stream) {
      for (const mapped of mapper.map(raw as ServeEvent)) {
        const outcome = yield* handle(mapped, input, client, decide);
        if (outcome === "idle") break stream;
        if (outcome === "error") {
          exitCode = 1;
          break stream;
        }
      }
    }
    if (input.signal?.aborted) exitCode = exitCode || 130;
  } catch (error) {
    if (!input.signal?.aborted) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: "log", stream: "stderr", content: `[opencode] ${message}` };
      yield { type: "error", content: message };
    }
    exitCode = 1;
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    events.abort();
    server?.close();
  }
  yield { type: "complete", exitCode };
}

async function* handle(
  mapped: MappedEvent,
  input: ServeTurnInput,
  client: OpencodeClient,
  decide: (request: PermissionAsk) => Promise<PermissionReply>
): AsyncGenerator<AgentEvent, "idle" | "error" | undefined> {
  switch (mapped.kind) {
    case "line":
      yield* input.parse(mapped.line);
      return;
    case "log":
      yield { type: "log", stream: mapped.stream, content: mapped.content };
      return;
    case "permission": {
      const { request } = mapped;
      // Answer off the stream loop so other events keep flowing while a person decides.
      void decide(request)
        .then((reply) => client.permission.reply({ requestID: request.id, reply }))
        .catch(() => {});
      return;
    }
    case "question":
      // No one can answer mid-turn yet; reject so the agent proceeds instead of hanging.
      yield {
        type: "log",
        stream: "system",
        content: `[opencode] question skipped: ${mapped.request.text}`,
      };
      void client.question.reject({ requestID: mapped.request.id }).catch(() => {});
      return;
    case "error":
      yield { type: "log", stream: "stderr", content: `[opencode] ${mapped.message}` };
      yield { type: "error", content: mapped.message };
      return "error";
    case "idle":
      return "idle";
  }
}
