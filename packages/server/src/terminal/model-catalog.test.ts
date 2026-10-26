import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as processTree from "../utils/process-tree";
import { buildHarnessLaunch } from "./harness";
import {
  harnessCli,
  harnessModels,
  modelReference,
  openCodeV2,
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

  describe("harnessCli", () => {
    test("returns output on success", async () => {
      const mockSpawn = spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          pid: 12345,
          stdout: new Blob(["success output"]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        } as any;
      });

      const output = await harnessCli(["dummy"]);
      expect(output).toBe("success output");

      mockSpawn.mockRestore();
    });

    test("throws error if exit code is not 0", async () => {
      const mockSpawn = spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          pid: 12345,
          stdout: new Blob([""]).stream(),
          stderr: new Blob(["error"]).stream(),
          exited: Promise.resolve(1),
        } as any;
      });

      await expect(harnessCli(["dummy"])).rejects.toThrow(
        "Não foi possível consultar o harness instalado."
      );

      mockSpawn.mockRestore();
    });

    test("kills process on timeout", async () => {
      const origSetTimeout = global.setTimeout;
      const killSpy = spyOn(processTree, "killProcessTree").mockImplementation(() =>
        Promise.resolve()
      );
      let resolveExited: any;
      const exitedPromise = new Promise((resolve) => {
        resolveExited = resolve;
      });

      const mockSpawn = spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          pid: 54321,
          stdout: new Blob([]).stream(),
          stderr: new Blob([]).stream(),
          exited: exitedPromise,
        } as any;
      });

      global.setTimeout = ((fn: any) => fn()) as any;

      try {
        const cliPromise = harnessCli(["dummy"]);
        resolveExited(1);
        await expect(cliPromise).rejects.toThrow("Não foi possível consultar o harness instalado.");
        expect(killSpy).toHaveBeenCalledWith(54321);
      } finally {
        global.setTimeout = origSetTimeout;
        mockSpawn.mockRestore();
        killSpy.mockRestore();
      }
    });
  });

  describe("openCodeV2", () => {
    test("returns true if version matches v2 pattern", async () => {
      const mockSpawn = spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          stdout: new Blob(["v2.0.0"]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        } as any;
      });
      const result = await openCodeV2();
      expect(result).toBe(true);
      mockSpawn.mockRestore();
    });

    test("returns false if version does not match v2 pattern", async () => {
      const mockSpawn = spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          stdout: new Blob(["1.0.0"]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        } as any;
      });
      const result = await openCodeV2();
      expect(result).toBe(false);
      mockSpawn.mockRestore();
    });
  });

  describe("parseOpenCodeCatalog", () => {
    test("throws if data is not an array", () => {
      expect(() => parseOpenCodeCatalog(JSON.stringify({ data: "not an array" }))).toThrow(
        "Catálogo de modelos inválido."
      );
      expect(() => parseOpenCodeCatalog(JSON.stringify({}))).toThrow(
        "Catálogo de modelos inválido."
      );
    });
  });

  describe("harnessModels", () => {
    test("opencode with v2 returns parsed models", async () => {
      let isTesting = true;
      const callArgs: any[] = [];
      const mockSpawn = spyOn(Bun, "spawn").mockImplementation((args: any) => {
        if (!isTesting)
          return {
            stdout: new Blob([]).stream(),
            stderr: new Blob([]).stream(),
            exited: Promise.resolve(0),
          } as any;
        callArgs.push(args);
        if (args.includes("--version")) {
          return {
            stdout: new Blob(["v2.0.0"]).stream(),
            stderr: new Blob([]).stream(),
            exited: Promise.resolve(0),
          } as any;
        }
        if (args.includes("/api/model")) {
          return {
            stdout: new Blob([
              JSON.stringify({
                data: [{ providerID: "p1", id: "m1", name: "Model 1", variants: [{ id: "v1" }] }],
              }),
            ]).stream(),
            stderr: new Blob([]).stream(),
            exited: Promise.resolve(0),
          } as any;
        }
        return {
          stdout: new Blob([]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        } as any;
      });

      const registryMock = { listModels: async () => [] } as any;
      try {
        const models = await harnessModels("opencode", registryMock);
        expect(models).toEqual([{ id: "p1/m1", name: "Model 1", efforts: ["v1"] }]);
      } finally {
        isTesting = false;
        mockSpawn.mockRestore();
      }
    });

    test("opencode with v1 returns verbose parsed models", async () => {
      let isTesting = true;
      const callArgs: any[] = [];
      const mockSpawn = spyOn(Bun, "spawn").mockImplementation((args: any) => {
        if (!isTesting)
          return {
            stdout: new Blob([]).stream(),
            stderr: new Blob([]).stream(),
            exited: Promise.resolve(0),
          } as any;
        callArgs.push(args);
        if (args.includes("--version")) {
          return {
            stdout: new Blob(["v1.0.0"]).stream(),
            stderr: new Blob([]).stream(),
            exited: Promise.resolve(0),
          } as any;
        }
        if (args.includes("--verbose")) {
          const verboseOutput =
            'p2/m2\n{\n  "name": "Model 2",\n  "variants": {\n    "v2": {}\n  }\n}\np3/m3\n{\n  "name": "p3/m3"\n}\np4/m4\n{\n}';
          return {
            stdout: new Blob([verboseOutput]).stream(),
            stderr: new Blob([]).stream(),
            exited: Promise.resolve(0),
          } as any;
        }
        return {
          stdout: new Blob([]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        } as any;
      });

      const registryMock = { listModels: async () => [] } as any;
      try {
        const models = await harnessModels("opencode", registryMock);
        expect(models).toEqual([
          { id: "p2/m2", name: "Model 2", efforts: ["v2"] },
          { id: "p3/m3", name: "p3/m3", efforts: [] },
          { id: "p4/m4", name: "p4/m4", efforts: [] },
        ]);
      } finally {
        isTesting = false;
        mockSpawn.mockRestore();
      }
    });

    test("opencode with v1 returns empty list if no matches", async () => {
      let isTesting = true;
      const callArgs: any[] = [];
      const mockSpawn = spyOn(Bun, "spawn").mockImplementation((args: any) => {
        if (!isTesting)
          return {
            stdout: new Blob([]).stream(),
            stderr: new Blob([]).stream(),
            exited: Promise.resolve(0),
          } as any;
        callArgs.push(args);
        if (args.includes("--version")) {
          return {
            stdout: new Blob(["v1.0.0"]).stream(),
            stderr: new Blob([]).stream(),
            exited: Promise.resolve(0),
          } as any;
        }
        if (args.includes("--verbose")) {
          return {
            stdout: new Blob(["no valid output"]).stream(),
            stderr: new Blob([]).stream(),
            exited: Promise.resolve(0),
          } as any;
        }
        return {
          stdout: new Blob([]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        } as any;
      });

      const registryMock = { listModels: async () => [] } as any;
      try {
        const models = await harnessModels("opencode", registryMock);
        expect(models).toEqual([]);
      } finally {
        isTesting = false;
        mockSpawn.mockRestore();
      }
    });

    test("claude-code uses process.env.VIBE_CLAUDE_CODE_MODELS", async () => {
      let isTesting = true;
      const origEnv = process.env.VIBE_CLAUDE_CODE_MODELS;
      process.env.VIBE_CLAUDE_CODE_MODELS = "env-model1, env-model2";

      const mockSpawn = spyOn(Bun, "spawn").mockImplementation(() => {
        if (!isTesting)
          return {
            stdout: new Blob([]).stream(),
            stderr: new Blob([]).stream(),
            exited: Promise.resolve(0),
          } as any;
        return {
          stdout: new Blob(["  --model 'help-model'"]).stream(),
          stderr: new Blob([]).stream(),
          exited: Promise.resolve(0),
        } as any;
      });

      const registryMock = { listModels: async () => [] } as any;
      try {
        const models = await harnessModels("claude-code", registryMock);
        expect(models).toEqual([
          { id: "help-model", name: "help-model", efforts: [] },
          { id: "env-model1", name: "env-model1", efforts: [] },
          { id: "env-model2", name: "env-model2", efforts: [] },
        ]);
      } finally {
        process.env.VIBE_CLAUDE_CODE_MODELS = origEnv;
        isTesting = false;
        mockSpawn.mockRestore();
      }
    });

    test("other engines use registry.listModels", async () => {
      const registryMock = { listModels: async (name: string) => [`${name}-model`] } as any;
      const models = await harnessModels("other-engine", registryMock);

      expect(models).toEqual([
        { id: "other-engine-model", name: "other-engine-model", efforts: [] },
      ]);
    });
  });

  describe("prepareOpenCodeSession edge cases", () => {
    test("throws on invalid session id format", async () => {
      let _isTesting = true;
      const cwd = await mkdtemp(join(tmpdir(), "vibe-session-invalid-id-"));
      try {
        await writeFile(join(cwd, "opencode-session.json"), JSON.stringify({ id: "invalid id!" }));
        await expect(
          prepareOpenCodeSession(cwd, "Title", undefined, undefined, undefined, "invalid id!")
        ).rejects.toThrow("Identificador da sessão OpenCode inválido.");
      } finally {
        _isTesting = false;
        await rm(cwd, { recursive: true, force: true });
      }
    });

    test("throws if openCode API doesn't return id for new session", async () => {
      const cwd = await mkdtemp(join(tmpdir(), "vibe-session-no-id-"));
      try {
        const run = async () => JSON.stringify({ data: { location: { directory: cwd } } });
        await expect(
          prepareOpenCodeSession(cwd, "Title", undefined, undefined, run)
        ).rejects.toThrow("OpenCode não retornou a sessão criada.");
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });
});
