import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHarnessLaunch } from "./harness";
import {
  modelReference,
  parseClaudeCatalog,
  parseOpenCodeCatalog,
  prepareOpenCodeSession,
  verifySessionWorkspace,
} from "./model-catalog";

describe("harness model and effort contract", () => {
  test("keeps the initial brief when migrating a legacy terminal to a new V2 conversation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "vibe-session-migration-"));
    try {
      await mkdir(join(cwd, ".vibe-code"));
      await writeFile(
        join(cwd, ".vibe-code/terminal.json"),
        JSON.stringify({ engine: "opencode" })
      );
      const run = async () =>
        JSON.stringify({ data: { id: "ses_new", location: { directory: cwd } } });
      const first = await prepareOpenCodeSession(cwd, "Brief", undefined, undefined, run);
      expect(first).toEqual({ id: "ses_new", resumed: false });
      const launch = buildHarnessLaunch({
        engine: "opencode",
        task: { title: "Brief" },
        sessionId: first.id,
        resume: first.resumed,
      });
      expect(launch.argv).toContain("--prompt");
      const next = await prepareOpenCodeSession(cwd, "Brief", undefined, undefined, run);
      expect(next).toEqual({ id: first.id, resumed: true });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
  test("attaches the terminal to the preceding chat run instead of creating another conversation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "vibe-chat-attach-"));
    const commands: string[][] = [];
    try {
      const run = async (argv: string[]) => {
        commands.push(argv);
        return JSON.stringify({ data: { id: "ses_chat", location: { directory: cwd } } });
      };
      expect(
        await prepareOpenCodeSession(
          cwd,
          "Chat",
          "fixture/reasoner#high",
          undefined,
          run,
          "ses_chat"
        )
      ).toEqual({ id: "ses_chat", resumed: true });
      expect(commands.some((args) => args.includes("/api/session"))).toBe(false);
      const model = commands.find((args) => args.includes("/api/session/ses_chat/model"));
      expect(model?.join(" ")).toContain('"variant":"high"');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
  test("reads Claude model aliases and effort from the installed CLI contract", () => {
    const help =
      "  --model <model>  Choose an alias, e.g.\n                   'swift' or 'solver'.\n  --effort <level> Effort level\n                   (low, high)\n  --name <name> Display name";
    expect(parseClaudeCatalog(help, ["custom-model"])).toEqual(
      ["swift", "solver", "custom-model"].map((id) => ({ id, name: id, efforts: ["low", "high"] }))
    );
    expect(parseClaudeCatalog("No model catalog advertised")).toEqual([]);
  });
  test("refuses a session marker from another workspace", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "vibe-session-owner-"));
    const other = await mkdtemp(join(tmpdir(), "vibe-session-other-"));
    try {
      await expect(verifySessionWorkspace(cwd, { directory: other })).rejects.toThrow(
        "outro workspace"
      );
      await expect(verifySessionWorkspace(cwd)).rejects.toThrow("não informou");
      await verifySessionWorkspace(cwd, { directory: cwd });
    } finally {
      await Promise.all([
        rm(cwd, { recursive: true, force: true }),
        rm(other, { recursive: true, force: true }),
      ]);
    }
  });
  test("uses the provider catalog variants without inventing a model list", () => {
    expect(
      parseOpenCodeCatalog(
        JSON.stringify({
          data: [
            {
              providerID: "fixture",
              id: "reasoner",
              name: "Reasoner",
              variants: [{ id: "fast" }, { id: "deep" }],
            },
            { providerID: "fixture", id: "plain", name: "Plain" },
          ],
        })
      )
    ).toEqual([
      { id: "fixture/reasoner", name: "Reasoner", efforts: ["fast", "deep"] },
      { id: "fixture/plain", name: "Plain", efforts: [] },
    ]);
    expect(modelReference("gateway/vendor/model", "deep")).toEqual({
      providerID: "gateway",
      id: "vendor/model",
      variant: "deep",
    });
    expect(() => modelReference("invalid")).toThrow("provider/model");
  });
  test("passes effort to Claude and resumes the exact OpenCode conversation", () => {
    const claude = buildHarnessLaunch({
      engine: "claude-code",
      task: { title: "Task" },
      model: "dynamic-model",
      effort: "high",
    });
    expect(claude.argv).toContain("--effort");
    expect(claude.argv[claude.argv.indexOf("--effort") + 1]).toBe("high");
    const opencode = buildHarnessLaunch({
      engine: "opencode",
      task: { title: "Task" },
      sessionId: "ses_fixture",
      resume: true,
    });
    expect(opencode.argv.slice(1)).toEqual(["--session", "ses_fixture"]);
  });
});
