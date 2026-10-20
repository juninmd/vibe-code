import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import * as litellmClient from "../../litellm-client";
import { CopilotEngine } from "../copilot";

describe("CopilotEngine", () => {
  let engine: CopilotEngine;

  beforeEach(() => {
    engine = new CopilotEngine();
    delete process.env.COPILOT_CLI_PATH;
    delete process.env.COPILOT_GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.VIBE_COPILOT_MODELS;
    delete process.env.VIBE_COPILOT_DEFAULT_MODELS;
  });

  afterEach(() => {
    mock.restore();
  });

  describe("getCopilotBinPath", () => {
    it("should use COPILOT_CLI_PATH if set", () => {
      process.env.COPILOT_CLI_PATH = "/custom/path/copilot";
      expect((engine as any).getCopilotBinPath()).toBe("/custom/path/copilot");
    });

    it("should use npm root fallback if execSync succeeds", () => {
      spyOn(childProcess, "execSync").mockReturnValue("/usr/lib/node_modules\n");
      const path = (engine as any).getCopilotBinPath();
      expect(path).toContain("/usr/lib/node_modules");
      expect(path).toContain("copilot");
    });

    it("should fallback to 'copilot' if execSync fails", () => {
      spyOn(childProcess, "execSync").mockImplementation(() => {
        throw new Error("failed");
      });
      expect((engine as any).getCopilotBinPath()).toBe("copilot");
    });
  });

  describe("getSetupIssue", () => {
    it("should return issue if not available", async () => {
      spyOn(engine, "isAvailable").mockResolvedValue(false);
      const issue = await engine.getSetupIssue();
      expect(issue).toContain("Copilot CLI não instalado");
    });

    it("should return issue if token is missing", async () => {
      spyOn(engine, "isAvailable").mockResolvedValue(true);
      const issue = await engine.getSetupIssue();
      expect(issue).toContain("COPILOT_GITHUB_TOKEN não configurado");
    });

    it("should return null if available and token exists", async () => {
      spyOn(engine, "isAvailable").mockResolvedValue(true);
      process.env.GH_TOKEN = "test-token";
      const issue = await engine.getSetupIssue();
      expect(issue).toBeNull();
    });
  });

  describe("listModels", () => {
    it("should return litellm models", async () => {
      spyOn(litellmClient, "listLiteLLMModels").mockResolvedValue([
        "github-copilot/gpt-4",
        "copilot/claude",
        "other/model",
      ]);
      const models = await engine.listModels();
      expect(models).toContain("github-copilot/gpt-4");
      expect(models).toContain("copilot/claude");
      expect(models).not.toContain("other/model");
    });

    it("should use VIBE_COPILOT_MODELS if provided", async () => {
      spyOn(litellmClient, "listLiteLLMModels").mockResolvedValue([]);
      process.env.VIBE_COPILOT_MODELS = "custom-model-1, custom-model-2";
      const models = await engine.listModels();
      expect(models).toContain("custom-model-1");
      expect(models).toContain("custom-model-2");
    });

    it("should fallback to default list if no models found", async () => {
      spyOn(litellmClient, "listLiteLLMModels").mockResolvedValue([]);
      process.env.VIBE_COPILOT_DEFAULT_MODELS = "fallback-1, fallback-2";
      const models = await engine.listModels();
      expect(models).toEqual(["fallback-1", "fallback-2"]);
    });
  });

  describe("buildChildEnv", () => {
    it("should include nativeOpenAiKey if provided", () => {
      const env = (engine as any).buildChildEnv("test-key");
      expect(env.OPENAI_API_KEY).toBe("test-key");
    });
  });
});
