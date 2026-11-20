import { afterEach, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import type { AgentEvent } from "../engine";
import { OpenCodeEngine } from "./opencode";
import type { ServeTurnInput } from "./opencode-serve/run";

class CapturingEngine extends OpenCodeEngine {
  inputs: ServeTurnInput[] = [];
  protected override runServe(input: ServeTurnInput) {
    this.inputs.push(input);
    return (async function* (): AsyncGenerator<AgentEvent> {
      yield { type: "complete", exitCode: 0 };
    })();
  }
}

async function run(engine: OpenCodeEngine, supervised: boolean) {
  const events: AgentEvent[] = [];
  for await (const event of engine.execute("go", tmpdir(), {
    runId: "r",
    model: "opencode/big-pickle",
    permissionMode: supervised ? "supervised" : "full",
    decidePermission: async () => "reject",
  })) {
    events.push(event);
  }
  return events;
}

const permissionOf = (input: ServeTurnInput) =>
  JSON.parse(String(input.env.OPENCODE_CONFIG_CONTENT)).permission as Record<string, string>;

afterEach(() => {
  delete process.env.VIBE_OPENCODE_TRANSPORT;
});

describe("OpenCode supervised sessions", () => {
  it("asks before edits, commands and web fetches and routes the decision to the operator", async () => {
    const engine = new CapturingEngine(60_000);
    await run(engine, true);
    const [input] = engine.inputs;
    const permission = permissionOf(input);
    // OpenCode applies the last matching rule: the catch-all must come first.
    expect(Object.keys(permission)[0]).toBe("*");
    expect(permission).toMatchObject({ edit: "ask", bash: "ask", webfetch: "ask" });
    expect(JSON.parse(String(input.env.OPENCODE_PERMISSION))).toEqual(permission);
    expect(
      await input.decide?.({
        id: "p",
        sessionID: "s",
        permission: "edit",
        patterns: [],
        metadata: {},
      })
    ).toBe("reject");
  });

  it("keeps full access, without a decision hook, for unsupervised sessions", async () => {
    const engine = new CapturingEngine(60_000);
    await run(engine, false);
    const [input] = engine.inputs;
    expect(Object.values(permissionOf(input)).every((action) => action === "allow")).toBe(true);
    expect(input.decide).toBeUndefined();
  });

  it("says so when the cli transport cannot honor approvals", async () => {
    process.env.VIBE_OPENCODE_TRANSPORT = "cli";
    class CliEngine extends OpenCodeEngine {
      protected override buildCommandArgs() {
        return [process.execPath, "-e", "process.exit(0)"];
      }
    }
    const events = await run(new CliEngine(60_000), true);
    expect(events.some((e) => e.content?.includes("approvals need the serve transport"))).toBe(
      true
    );
  });
});

describe("refused tool calls", () => {
  it("land in the work log as the operator's decision, not as a harness error", () => {
    const events = new OpenCodeEngine(60_000).parseLine(
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "write",
          state: {
            status: "error",
            input: { filePath: "src/email.ts" },
            error: "The user rejected permission to use this specific tool call.",
          },
        },
      })
    );
    expect(events.filter((e) => e.type === "log").map((e) => [e.stream, e.content])).toEqual([
      ["stdout", "  Writing src/email.ts"],
      ["stdout", "    Recusado por você"],
    ]);
    expect(events.some((e) => e.type === "tool_result" && e.toolResult?.status === "error")).toBe(
      true
    );
  });
});
