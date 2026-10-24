import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as fsPromises from "node:fs/promises";
import * as litellmClient from "../../litellm-client";
import * as streamProcessModule from "../../stream-process";
import { PiEngine } from "../pi";

describe("PiEngine", () => {
  let engine: PiEngine;

  beforeEach(() => {
    engine = new PiEngine();
  });

  afterEach(() => {
    mock.restore();
  });

  describe("isAvailable", () => {
    it("should return true when command succeeds", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          exited: Promise.resolve(0),
          exitCode: 0,
        } as any;
      });
      expect(await engine.isAvailable()).toBe(true);
    });

    it("should return false when command fails", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          exited: Promise.resolve(1),
          exitCode: 1,
        } as any;
      });
      expect(await engine.isAvailable()).toBe(false);
    });

    it("should return false on exception", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("spawn failed");
      });
      expect(await engine.isAvailable()).toBe(false);
    });
  });

  describe("getVersion", () => {
    it("should return version string on success", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          exited: Promise.resolve(0),
          exitCode: 0,
          stdout: new Blob(["pi 0.1.0\n"]).stream(),
        } as any;
      });
      expect(await engine.getVersion()).toBe("pi 0.1.0");
    });

    it("should return null on non-zero exit", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        return {
          exited: Promise.resolve(1),
          exitCode: 1,
        } as any;
      });
      expect(await engine.getVersion()).toBeNull();
    });

    it("should return null on exception", async () => {
      spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("spawn failed");
      });
      expect(await engine.getVersion()).toBeNull();
    });
  });

  describe("listModels", () => {
    it("should return models from litellm", async () => {
      spyOn(litellmClient, "listLiteLLMModels").mockResolvedValue(["model1", "model2"]);
      const models = await engine.listModels();
      expect(models).toEqual(["model1", "model2"]);
    });
  });

  describe("execute", () => {
    it("should yield log event and stream process output", async () => {
      spyOn(fsPromises, "writeFile").mockResolvedValue();
      spyOn(fsPromises, "unlink").mockResolvedValue();

      const mockProc = {
        exited: Promise.resolve(0),
        kill: mock(),
      };

      spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      spyOn(streamProcessModule, "streamProcess").mockImplementation(async function* () {
        yield { type: "log", stream: "stdout", content: "output" } as any;
      });

      const events = [];
      const generator = engine.execute("test prompt", "/tmp", { runId: "run123" });

      for await (const event of generator) {
        events.push(event);
      }

      expect(events.length).toBe(2);
      expect(events[0]).toEqual({
        type: "log",
        stream: "system",
        content: "[pi] Starting in /tmp",
      });
      expect(events[1]).toEqual({ type: "log", stream: "stdout", content: "output" });

      expect(fsPromises.writeFile).toHaveBeenCalled();
      expect(fsPromises.unlink).toHaveBeenCalled();
      expect(Bun.spawn).toHaveBeenCalled();
    });

    it("should kill stale process if runId exists", async () => {
      spyOn(fsPromises, "writeFile").mockResolvedValue();
      spyOn(fsPromises, "unlink").mockResolvedValue();

      const staleProc = { kill: mock() };
      (engine as any).processes.set("run123", staleProc);

      spyOn(Bun, "spawn").mockReturnValue({} as any);

      spyOn(streamProcessModule, "streamProcess").mockImplementation(async function* () {});

      const generator = engine.execute("test", "/tmp", { runId: "run123" });
      for await (const _ of generator) {
      }

      expect(staleProc.kill).toHaveBeenCalled();
    });

    it("should set environment variables based on options", async () => {
      spyOn(fsPromises, "writeFile").mockResolvedValue();
      spyOn(fsPromises, "unlink").mockResolvedValue();

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({} as any);
      spyOn(streamProcessModule, "streamProcess").mockImplementation(async function* () {});

      const generator = engine.execute("test", "/tmp", {
        runId: "run1",
        litellmKey: "lite-key",
        litellmBaseUrl: "http://lite",
      });
      for await (const _ of generator) {
      }

      const env = spawnSpy.mock.calls[0][1]?.env as any;
      expect(env.OPENAI_API_KEY).toBe("lite-key");
      expect(env.OPENAI_API_BASE).toBe("http://lite/v1");
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it("should use native keys if litellmKey is not provided", async () => {
      spyOn(fsPromises, "writeFile").mockResolvedValue();
      spyOn(fsPromises, "unlink").mockResolvedValue();

      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({} as any);
      spyOn(streamProcessModule, "streamProcess").mockImplementation(async function* () {});

      const generator = engine.execute("test", "/tmp", {
        runId: "run1",
        nativeApiKeys: { openai: "native-openai", anthropic: "native-anthropic" },
      });
      for await (const _ of generator) {
      }

      const env = spawnSpy.mock.calls[0][1]?.env as any;
      expect(env.OPENAI_API_KEY).toBe("native-openai");
      expect(env.ANTHROPIC_API_KEY).toBe("native-anthropic");
    });
  });

  describe("abort", () => {
    it("should kill process and delete from map", () => {
      const mockProc = { kill: mock() };
      (engine as any).processes.set("run1", mockProc);

      engine.abort("run1");

      expect(mockProc.kill).toHaveBeenCalled();
      expect((engine as any).processes.has("run1")).toBe(false);
    });

    it("should do nothing if runId not found", () => {
      expect(() => engine.abort("nonexistent")).not.toThrow();
    });
  });

  describe("sendInput", () => {
    it("should write to stdin and flush", () => {
      const mockSink = { write: mock(), flush: mock() };
      const mockProc = { stdin: mockSink };
      (engine as any).processes.set("run1", mockProc);

      const result = engine.sendInput("run1", "input text");

      expect(result).toBe(true);
      expect(mockSink.write).toHaveBeenCalledWith("input text\n");
      expect(mockSink.flush).toHaveBeenCalled();
    });

    it("should return false if process not found", () => {
      const result = engine.sendInput("run1", "input");
      expect(result).toBe(false);
    });

    it("should return false if stdin is missing", () => {
      const mockProc = {};
      (engine as any).processes.set("run1", mockProc);

      const result = engine.sendInput("run1", "input");

      expect(result).toBe(false);
    });
  });
});
