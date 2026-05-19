import { describe, expect, it } from "bun:test";
import { GeminiEngine } from "./gemini";

// buildGeminiChildEnv is private; expose via cast for the env-assertion test.
type Internal = {
  buildGeminiChildEnv: (
    litellmKey?: string,
    litellmBaseUrl?: string,
    nativeGeminiKey?: string,
    geminiBinDir?: string,
    extraEnv?: Record<string, string>
  ) => NodeJS.ProcessEnv;
};

describe("Gemini env injection", () => {
  it("defaults GEMINI_CLI_TRUST_WORKSPACE=true to bypass folder-trust gate", () => {
    const engine = new GeminiEngine() as unknown as Internal;
    const env = engine.buildGeminiChildEnv();
    expect(env.GEMINI_CLI_TRUST_WORKSPACE).toBe("true");
  });

  it("caller env wins over default", () => {
    const engine = new GeminiEngine() as unknown as Internal;
    const env = engine.buildGeminiChildEnv(undefined, undefined, undefined, undefined, {
      GEMINI_CLI_TRUST_WORKSPACE: "false",
    });
    expect(env.GEMINI_CLI_TRUST_WORKSPACE).toBe("false");
  });

  it("strips IDE binding env vars to avoid Gemini IDE client lock-in", () => {
    const orig = process.env.GEMINI_CLI_IDE_SERVER_PORT;
    process.env.GEMINI_CLI_IDE_SERVER_PORT = "9999";
    try {
      const engine = new GeminiEngine() as unknown as Internal;
      const env = engine.buildGeminiChildEnv();
      expect(env.GEMINI_CLI_IDE_SERVER_PORT).toBeUndefined();
    } finally {
      if (orig === undefined) delete process.env.GEMINI_CLI_IDE_SERVER_PORT;
      else process.env.GEMINI_CLI_IDE_SERVER_PORT = orig;
    }
  });
});
