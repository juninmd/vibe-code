import { afterEach, describe, expect, it } from "bun:test";
import { splitModelVariant } from "./engines/opencode";
import {
  buildOpenCodeOverlay,
  isLiteLLMModel,
  LITELLM_KEY_ENV,
  liteLLMModelId,
  openAICompatibleBaseUrl,
  openCodeProviderLaunch,
  providerEnv,
  readOpenCodeProviderSettings,
  resolveLiteLLMRuntime,
} from "./opencode-providers";

const settingsOf = (values: Record<string, string>) => ({ get: (key: string) => values[key] });

describe("readOpenCodeProviderSettings", () => {
  it("reads OpenCode Go and LiteLLM settings from the DB", () => {
    const settings = readOpenCodeProviderSettings(
      settingsOf({
        opencode_go_api_key: "go-key",
        litellm_base_url: "https://llm.example.com",
        litellm_api_key: "sk-litellm",
        litellm_models: "gpt-4o, claude-sonnet\nqwen3-coder",
      }),
      {}
    );
    expect(settings.goApiKey).toBe("go-key");
    expect(settings.litellm).toEqual({
      enabled: true,
      baseUrl: "https://llm.example.com",
      apiKey: "sk-litellm",
      models: ["gpt-4o", "claude-sonnet", "qwen3-coder"],
    });
  });

  it("falls back to env vars and honors the disabled flag", () => {
    const settings = readOpenCodeProviderSettings(settingsOf({ litellm_enabled: "false" }), {
      OPENCODE_API_KEY: "env-go",
      LITELLM_MASTER_KEY: "sk-master",
      LITELLM_MODELS: "a,b",
    });
    expect(settings.goApiKey).toBe("env-go");
    expect(settings.litellm.enabled).toBe(false);
    expect(settings.litellm.apiKey).toBe("sk-master");
    expect(settings.litellm.models).toEqual(["a", "b"]);
  });
});

describe("LiteLLM helpers", () => {
  it("normalizes the OpenAI-compatible base URL", () => {
    expect(openAICompatibleBaseUrl("http://localhost:4000")).toBe("http://localhost:4000/v1");
    expect(openAICompatibleBaseUrl("http://localhost:4000/")).toBe("http://localhost:4000/v1");
    expect(openAICompatibleBaseUrl("https://x/v1/")).toBe("https://x/v1");
  });

  it("recognizes litellm models and strips provider and effort", () => {
    expect(isLiteLLMModel("litellm/openai/gpt-4o")).toBe(true);
    expect(isLiteLLMModel("opencode-go/glm-5.3")).toBe(false);
    expect(liteLLMModelId("litellm/openai/gpt-4o#high")).toBe("openai/gpt-4o");
  });

  it("prefers a per-run virtual key and returns null without any key", () => {
    const base = readOpenCodeProviderSettings(settingsOf({ litellm_api_key: "static" }), {});
    expect(resolveLiteLLMRuntime(base)?.apiKey).toBe("static");
    expect(resolveLiteLLMRuntime(base, { apiKey: "virtual" })?.apiKey).toBe("virtual");
    const none = readOpenCodeProviderSettings(settingsOf({}), {});
    expect(resolveLiteLLMRuntime(none)).toBeNull();
    const disabled = readOpenCodeProviderSettings(
      settingsOf({ litellm_enabled: "false", litellm_api_key: "k" }),
      {}
    );
    expect(resolveLiteLLMRuntime(disabled)).toBeNull();
  });
});

describe("buildOpenCodeOverlay", () => {
  it("declares LiteLLM as an OpenAI-compatible provider without embedding the key", () => {
    const config = buildOpenCodeOverlay({
      permission: { "*": "allow" },
      litellm: { baseUrl: "http://gw/v1", models: ["gpt-4o", "gpt-4o"] },
      skillDirs: ["/skills", "/skills", ""],
      mcp: {},
    });
    expect(config).toEqual({
      $schema: "https://opencode.ai/config.json",
      permission: { "*": "allow" },
      skills: ["/skills"],
      provider: {
        litellm: {
          npm: "@ai-sdk/openai-compatible",
          name: "LiteLLM",
          options: { baseURL: "http://gw/v1", apiKey: `{env:${LITELLM_KEY_ENV}}` },
          models: { "gpt-4o": { name: "gpt-4o" } },
        },
      },
    });
    expect(JSON.stringify(config)).not.toContain("sk-");
  });
});

describe("openCodeProviderLaunch", () => {
  const settings = readOpenCodeProviderSettings(
    settingsOf({
      opencode_go_api_key: "go-key",
      litellm_base_url: "http://gw:4000",
      litellm_api_key: "sk-static",
    }),
    {}
  );

  it("adds the selected LiteLLM model and passes keys through env", async () => {
    const launch = await openCodeProviderLaunch({ model: "litellm/qwen3-coder#high" }, settings);
    const config = JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT);
    expect(config.provider.litellm.options.baseURL).toBe("http://gw:4000/v1");
    expect(Object.keys(config.provider.litellm.models)).toEqual(["qwen3-coder"]);
    expect(launch.env[LITELLM_KEY_ENV]).toBe("sk-static");
  });

  it("does not override an OPENCODE_API_KEY already in the environment", () => {
    expect(providerEnv(settings, null, {}).OPENCODE_API_KEY).toBe("go-key");
    expect(providerEnv(settings, null, { OPENCODE_API_KEY: "x" }).OPENCODE_API_KEY).toBeUndefined();
  });

  describe("model discovery", () => {
    const original = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = original;
    });

    it("lists the gateway models with the configured key", async () => {
      let auth = "";
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        auth = new Headers(init?.headers).get("authorization") ?? "";
        return Response.json({ data: [{ id: "gpt-4o" }, { id: "claude-sonnet" }] });
      }) as unknown as typeof fetch;
      const launch = await openCodeProviderLaunch({ discoverModels: true }, settings);
      const models = (launch.config.provider as Record<string, { models: object }>).litellm.models;
      expect(Object.keys(models)).toEqual(["gpt-4o", "claude-sonnet"]);
      expect(auth).toBe("Bearer sk-static");
    });
  });
});

describe("splitModelVariant", () => {
  it("turns the effort suffix into an OpenCode variant", () => {
    expect(splitModelVariant("opencode-go/glm-5.3#high")).toEqual({
      model: "opencode-go/glm-5.3",
      variant: "high",
    });
    expect(splitModelVariant("litellm/gpt-4o")).toEqual({ model: "litellm/gpt-4o" });
  });
});
