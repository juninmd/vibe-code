/**
 * Real OpenCode against a fake LiteLLM gateway (OpenAI-compatible).
 *
 * Opt-in: set VIBE_OPENCODE_E2E_BIN to an `opencode` binary (1.x or 2.x).
 *   VIBE_OPENCODE_E2E_BIN=$(which opencode) bun test opencode.e2e
 *
 * Proves the whole chain the remote workspace relies on: the inline provider
 * config reaches OpenCode, the selected `litellm/<model>` is requested with the
 * configured key, and project skills (.opencode/skills) are offered to the model.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../engine";
import { readOpenCodeProviderSettings, setOpenCodeProviderSource } from "../opencode-providers";
import { OpenCodeEngine } from "./opencode";

const BIN = process.env.VIBE_OPENCODE_E2E_BIN;

describe.skipIf(!BIN)("OpenCode e2e with a LiteLLM gateway", () => {
  let server: ReturnType<typeof Bun.serve>;
  let root: string;
  const requests: { auth: string | null; body: any }[] = [];

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith("/models")) return Response.json({ data: [{ id: "e2e-model" }] });
        const body = await req.json();
        requests.push({ auth: req.headers.get("authorization"), body });
        const chunk = (delta: object, finish: string | null) =>
          `data: ${JSON.stringify({
            id: "c",
            object: "chat.completion.chunk",
            created: 1,
            model: body.model,
            choices: [{ index: 0, delta, finish_reason: finish }],
            ...(finish
              ? { usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }
              : {}),
          })}\n\n`;
        return new Response(
          `${chunk({ role: "assistant", content: "pong from litellm" }, null)}${chunk({}, "stop")}data: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } }
        );
      },
    });
    root = await mkdtemp(join(tmpdir(), "vibe-opencode-e2e-"));
    const repo = join(root, "repo");
    await mkdir(join(repo, ".opencode", "skills", "release-notes"), { recursive: true });
    await writeFile(
      join(repo, ".opencode", "skills", "release-notes", "SKILL.md"),
      "---\nname: release-notes\ndescription: Write release notes for the e2e repo\n---\nUse bullet points.\n"
    );
    await mkdir(join(root, "catalog", "skills", "triage"), { recursive: true });
    await writeFile(
      join(root, "catalog", "skills", "triage", "SKILL.md"),
      "---\nname: triage\ndescription: Triage incoming bugs from the vibe-code catalog\n---\nAsk for logs.\n"
    );
    const git = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: repo });
    git(["init", "-q"]);
    git(["add", "-A"]);
    git(["-c", "user.email=e2e@local", "-c", "user.name=e2e", "commit", "-qm", "init"]);
    setOpenCodeProviderSource(() =>
      readOpenCodeProviderSettings(
        {
          get: (key) =>
            ({
              litellm_base_url: `http://127.0.0.1:${server.port}`,
              litellm_api_key: "sk-e2e",
            })[key],
        },
        {}
      )
    );
  });

  afterAll(async () => {
    server?.stop(true);
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("runs a LiteLLM model and exposes project and catalog skills", async () => {
    class E2EEngine extends OpenCodeEngine {
      protected override buildCommandArgs(model: string, workdir: string, resume?: string) {
        const args = super.buildCommandArgs(model, workdir, resume);
        args[0] = BIN as string;
        return args;
      }
    }
    const events: AgentEvent[] = [];
    for await (const event of new E2EEngine().execute("ping", join(root, "repo"), {
      runId: "e2e",
      model: "litellm/e2e-model",
      skillDirs: [join(root, "catalog", "skills")],
      env: {
        XDG_DATA_HOME: join(root, "data"),
      },
    })) {
      events.push(event);
    }
    const text = events
      .filter((e) => e.type === "log" && e.stream === "stdout")
      .map((e) => (e as { content: string }).content)
      .join("\n");
    expect(text).toContain("pong from litellm");
    expect(events.some((e) => e.type === "session")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "complete", exitCode: 0 });

    const main = requests.find((r) => Array.isArray(r.body.tools) && r.body.tools.length > 0);
    expect(main?.body.model).toBe("e2e-model");
    expect(main?.auth).toBe("Bearer sk-e2e");
    expect(JSON.stringify(main?.body)).toContain("Write release notes for the e2e repo");
    expect(JSON.stringify(main?.body)).toContain("Triage incoming bugs from the vibe-code catalog");
  }, 180_000);
});
