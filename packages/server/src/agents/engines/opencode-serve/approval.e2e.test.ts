/**
 * Real `opencode serve` asking for approval, against a fake OpenAI-compatible gateway
 * whose model always tries to write a file first.
 *
 * Opt-in: VIBE_OPENCODE_E2E_BIN=$(which opencode) bun test approval.e2e
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApprovalReply } from "@vibe-code/shared";
import type { ApprovalAsk } from "../../approvals";
import type { AgentEvent } from "../../engine";
import { readOpenCodeProviderSettings, setOpenCodeProviderSource } from "../../opencode-providers";
import { OpenCodeEngine } from "../opencode";
import type { ServeTurnInput } from "./run";

const BIN = process.env.VIBE_OPENCODE_E2E_BIN;

function sse(chunks: object[]): Response {
  const body = chunks
    .map((delta, i) => ({
      id: "c",
      object: "chat.completion.chunk",
      created: 1,
      model: "e2e-model",
      choices: [
        {
          index: 0,
          ...delta,
          finish_reason:
            i === chunks.length - 1 ? ((delta as { finish?: string }).finish ?? "stop") : null,
        },
      ],
    }))
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("");
  return new Response(`${body}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe.skipIf(!BIN)("OpenCode serve approvals e2e", () => {
  let gateway: ReturnType<typeof Bun.serve>;
  let root: string;

  beforeAll(async () => {
    gateway = Bun.serve({
      port: 0,
      async fetch(req) {
        if (new URL(req.url).pathname.endsWith("/models"))
          return Response.json({ data: [{ id: "e2e-model" }] });
        const body = await req.json();
        const last = body.messages.at(-1);
        if (!Array.isArray(body.tools) || body.tools.length === 0)
          return sse([{ delta: { role: "assistant", content: "Title" } }]);
        if (last.role === "tool") return sse([{ delta: { role: "assistant", content: "Done." } }]);
        return sse([
          {
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "write",
                    arguments: JSON.stringify({ filePath: "hello.txt", content: "hi\n" }),
                  },
                },
              ],
            },
            finish: "tool_calls",
          },
        ]);
      },
    });
    root = await mkdtemp(join(tmpdir(), "vibe-approval-e2e-"));
    setOpenCodeProviderSource(() =>
      readOpenCodeProviderSettings(
        {
          get: (key) =>
            ({ litellm_base_url: `http://127.0.0.1:${gateway.port}`, litellm_api_key: "sk" })[key],
        },
        {}
      )
    );
  });

  afterAll(async () => {
    gateway?.stop(true);
    if (root) await rm(root, { recursive: true, force: true });
  });

  class E2EEngine extends OpenCodeEngine {
    protected override runServe(input: ServeTurnInput) {
      return super.runServe({ ...input, binary: BIN as string });
    }
  }

  async function turn(name: string, reply: ApprovalReply) {
    const repo = join(root, name);
    await mkdir(repo, { recursive: true });
    Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
    const asks: ApprovalAsk[] = [];
    const events: AgentEvent[] = [];
    for await (const event of new E2EEngine(60_000).execute("write hello", repo, {
      runId: name,
      model: "litellm/e2e-model",
      permissionMode: "supervised",
      decidePermission: async (ask) => {
        asks.push(ask);
        return reply;
      },
      env: { XDG_DATA_HOME: join(root, `${name}-data`) },
    })) {
      events.push(event);
    }
    return { repo, asks, events };
  }

  it("writes only after the operator approves", async () => {
    const { repo, asks } = await turn("approved", "once");
    expect(asks[0]).toMatchObject({ permission: "edit", patterns: ["hello.txt"] });
    expect(String(asks[0].metadata?.diff)).toContain("+hi");
    expect(existsSync(join(repo, "hello.txt"))).toBe(true);
  }, 120_000);

  it("leaves the workspace untouched when the operator refuses", async () => {
    const { repo, asks } = await turn("refused", "reject");
    expect(asks).toHaveLength(1);
    expect(existsSync(join(repo, "hello.txt"))).toBe(false);
  }, 120_000);
});
