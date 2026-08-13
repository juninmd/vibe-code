import { mock, spyOn, describe, it, expect, beforeEach, afterEach } from "bun:test";

let mockAccessSuccess = true;
let mockMkdirCalled = false;
let mockWriteFileCalled = false;

mock.module("node:fs/promises", () => ({
  access: async () => {
    if (!mockAccessSuccess) throw new Error("ENOENT");
  },
  unlink: async () => {},
  writeFile: async () => {
    mockWriteFileCalled = true;
  },
  mkdir: async () => {
    mockMkdirCalled = true;
  },
}));

mock.module("../litellm-client", () => ({
  getLiteLLMBaseUrl: () => "http://litellm:4000",
  listLiteLLMModels: async () => ["gemini-1.5-pro", "gemini-flash-litellm", "gpt-4"],
}));

let killProcessTreeCalled = false;
mock.module("../../utils/process-tree", () => ({
  killProcessTree: (pid: number) => {
    killProcessTreeCalled = true;
  },
}));

import { GeminiEngine } from "./gemini";
import type { EngineOptions } from "../engine";

describe("GeminiEngine", () => {
  let engine: GeminiEngine;
  let originalSpawn: any;
  let originalWrite: any;

  beforeEach(() => {
    engine = new GeminiEngine();
    mockAccessSuccess = true;
    mockMkdirCalled = false;
    mockWriteFileCalled = false;
    killProcessTreeCalled = false;

    // Clear cached models
    (engine as any).cachedModels = null;
    (engine as any).geminiCommand = undefined;

    originalSpawn = Bun.spawn;
    originalWrite = Bun.write;

    spyOn(Bun, "write").mockImplementation(async () => 0);
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    Bun.write = originalWrite;
    process.env.APPDATA = undefined;
  });

  describe("isAvailable and hasCli", () => {
    it("returns true when CLI is available", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          exited: Promise.resolve(),
          exitCode: 0,
        } as any;
      });
      const result = await engine.isAvailable();
      expect(result).toBe(true);
    });

    it("returns false when CLI is not available", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          exited: Promise.reject(new Error("Command not found")),
        } as any;
      });
      const result = await engine.isAvailable();
      expect(result).toBe(false);
    });

    it("returns false when command resolution fails", async () => {
      mockAccessSuccess = false;
      const result = await engine.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe("getVersion", () => {
    it("returns version string on success", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          exited: Promise.resolve(),
          exitCode: 0,
          stdout: new Blob(["1.2.3\n"]).stream(),
        } as any;
      });
      const version = await engine.getVersion();
      expect(version).toBe("1.2.3");
    });

    it("returns null on non-zero exit code", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          exited: Promise.resolve(),
          exitCode: 1,
          stdout: new Blob(["error\n"]).stream(),
        } as any;
      });
      const version = await engine.getVersion();
      expect(version).toBeNull();
    });

    it("returns null on throw", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          exited: Promise.reject(new Error("err")),
        } as any;
      });
      const version = await engine.getVersion();
      expect(version).toBeNull();
    });
  });

  describe("listModels", () => {
    it("returns models from CLI and litellm", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          exited: Promise.resolve(),
          exitCode: 0,
          stdout: new Blob(["`gemini-1.5-pro`\n`gemini-2.0-flash`\nauto\npro"]).stream(),
        } as any;
      });

      const models = await engine.listModels();
      expect(models).toContain("gemini-1.5-pro");
      expect(models).toContain("gemini-2.0-flash");
      expect(models).toContain("auto");
      expect(models).toContain("pro");
      expect(models).toContain("gemini-flash-litellm"); // from mock litellm
      expect(models).not.toContain("gpt-4");
    });

    it("falls back to default models if CLI returns nothing", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          exited: Promise.resolve(),
          exitCode: 1,
          stdout: new Blob([""]).stream(),
        } as any;
      });

      // Override litellm mock to return empty for this test
      const litellmClient = await import("../litellm-client");
      spyOn(litellmClient, "listLiteLLMModels").mockResolvedValueOnce([]);

      const models = await engine.listModels();
      expect(models).toContain("gemini-1.5-pro");
      expect(models).toContain("auto");
    });

    it("uses cached models on subsequent calls", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          exited: Promise.resolve(),
          exitCode: 0,
          stdout: new Blob(["`gemini-test-cache`\n"]).stream(),
        } as any;
      });

      await engine.listModels();
      const models2 = await engine.listModels();

      // spawn should only be called once, so we can verify this by modifying the mock
      spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("Should not be called");
      });

      const models3 = await engine.listModels();
      expect(models3).toContain("gemini-test-cache");
    });
  });

  describe("getSetupIssue", () => {
    it("returns null if available", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return { exited: Promise.resolve(), exitCode: 0 } as any;
      });
      const issue = await engine.getSetupIssue();
      expect(issue).toBeNull();
    });

    it("returns error message if not available", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return { exited: Promise.reject(new Error("Command not found")) } as any;
      });
      const issue = await engine.getSetupIssue();
      expect(issue).toBe("Gemini CLI não instalado");
    });
  });

  describe("prepareWorkdir", () => {
    it("creates .gemini directory and writes config.json", async () => {
      const files = await engine.prepareWorkdir("/fake/dir", {} as any);
      expect(mockMkdirCalled).toBe(true);
      expect(mockWriteFileCalled).toBe(true);
      expect(files[0]).toContain("config.json");
    });
  });

  describe("execute", () => {
    it("throws error if CLI is not installed", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return { exited: Promise.reject(new Error("Command not found")) } as any;
      });

      try {
        const generator = engine.execute("test prompt", "/workdir", {});
        await generator.next();
        expect().fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("Gemini CLI not installed or not on PATH");
      }
    });

    it("yields events and parses acp message", async () => {
      // Just mock streamProcess to avoid dealing with the async generator stream consumption loops in tests
      const originalStreamProcess = await import("../stream-process");
      spyOn(originalStreamProcess, "streamProcess").mockImplementation(async function* () {
        yield { type: "log", stream: "system", content: "hello from gemini" };
      });

      spyOn(Bun, "spawn").mockImplementation((args) => {
        return {
          exited: Promise.resolve(),
          exitCode: 0,
          pid: 12345,
          kill: () => {},
        } as any;
      });

      const options: EngineOptions = { model: "pro", runId: "test-run" };
      const generator = engine.execute("test prompt", "/workdir", options);

      const event1 = await generator.next();
      expect(event1.value.content).toContain("[gemini] Starting in /workdir");

      const event2 = await generator.next();
      expect(event2.value.content).toContain("model=pro");

      const event3 = await generator.next();
      expect(event3.value.content).toContain("[gemini] Process started");

      const event4 = await generator.next();
      expect(event4.value.type).toBe("log");
      expect(event4.value.content).toBe("hello from gemini");
    });

    it("handles stale process killing", async () => {
       spyOn(Bun, "spawn").mockImplementation((args) => {
        if (args[1] === "--version") {
          return { exited: Promise.resolve(), exitCode: 0 } as any;
        }
        return {
          exited: Promise.resolve(),
          exitCode: 0,
          stdout: new Blob([""]).stream(),
          stderr: new Blob([""]).stream(),
          pid: 12345,
          kill: () => {},
        } as any;
      });

      const options = { runId: "stale-run" };

      // Inject a stale process
      let killed = false;
      (engine as any).processes.set("stale-run", { kill: () => { killed = true; } });

      const generator = engine.execute("test prompt", "/workdir", options);
      await generator.next(); // Starting...
      await generator.next(); // Context...
      await generator.next(); // Process...

      // Force generator to finish
      for await (const _ of generator) {}

      expect(killed).toBe(true);
    });
  });

  describe("abort", () => {
    it("kills the process tree if process exists", () => {
      (engine as any).processes.set("test-run", { pid: 9999 } as any);
      engine.abort("test-run");

      // Need a small timeout to allow dynamic import of process-tree to resolve
      // Instead, we just wait a tick since process-tree import is dynamic in abort
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(killProcessTreeCalled).toBe(true);
          expect((engine as any).processes.has("test-run")).toBe(false);
          resolve();
        }, 10);
      });
    });

    it("does nothing if process does not exist", () => {
      engine.abort("non-existent");
      expect(killProcessTreeCalled).toBe(false);
    });
  });

  describe("sendInput", () => {
    it("writes to stdin if available", () => {
      let writtenData = "";
      let flushed = false;
      const mockStdin = {
        write: (data: string) => { writtenData += data; },
        flush: () => { flushed = true; },
      };

      (engine as any).processes.set("input-run", { stdin: mockStdin } as any);

      const result = engine.sendInput("input-run", "test input");
      expect(result).toBe(true);
      expect(writtenData).toBe("test input\n");
      expect(flushed).toBe(true);
    });

    it("returns false if process or stdin not available", () => {
      const result = engine.sendInput("non-existent", "test");
      expect(result).toBe(false);

      (engine as any).processes.set("no-stdin", {} as any);
      const result2 = engine.sendInput("no-stdin", "test");
      expect(result2).toBe(false);
    });
  });
});
