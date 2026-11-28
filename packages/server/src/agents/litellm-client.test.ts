import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  checkLiteLLMHealth,
  deleteVirtualKey,
  generateVirtualKey,
  getLiteLLMBaseUrl,
  listLiteLLMModels,
} from "./litellm-client";

describe("Litellm Client", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getLiteLLMBaseUrl", () => {
    it("returns env LITELLM_BASE_URL over dbBaseUrl", () => {
      process.env.LITELLM_BASE_URL = "http://env-url";
      expect(getLiteLLMBaseUrl("http://db-url")).toBe("http://env-url");
    });

    it("returns dbBaseUrl if env LITELLM_BASE_URL is not set", () => {
      process.env.LITELLM_BASE_URL = "";
      expect(getLiteLLMBaseUrl("http://db-url")).toBe("http://db-url");
    });

    it("returns default url if neither env nor db base url are set", () => {
      process.env.LITELLM_BASE_URL = "";
      expect(getLiteLLMBaseUrl("")).toBe("http://localhost:4000");
    });
  });

  describe("getMasterKey internally", () => {
    it("throws if LITELLM_MASTER_KEY is not set when calling generateVirtualKey", async () => {
      process.env.LITELLM_MASTER_KEY = "";
      await expect(generateVirtualKey("task123", "engine", "url")).rejects.toThrow(
        "LITELLM_MASTER_KEY is not set"
      );
    });
  });

  describe("generateVirtualKey", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      process.env.LITELLM_MASTER_KEY = "master-key";
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("generates and returns virtual key", async () => {
      global.fetch = Object.assign(
        mock().mockResolvedValue({
          ok: true,
          json: async () => ({ key: "vkey-123", token_id: "tid-123" }),
        }),
        { preconnect: () => {} }
      ) as any;

      const result = await generateVirtualKey("task123", "engine1", "http://test-url");
      expect(result).toEqual({ key: "vkey-123", tokenId: "tid-123" });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-url/key/generate",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer master-key" },
        })
      );
    });

    it("falls back to token if key or token_id are missing", async () => {
      global.fetch = Object.assign(
        mock().mockResolvedValue({
          ok: true,
          json: async () => ({ token: "token-fallback" }),
        }),
        { preconnect: () => {} }
      ) as any;

      const result = await generateVirtualKey("task123", "engine1", "http://test-url");
      expect(result).toEqual({ key: "token-fallback", tokenId: "token-fallback" });
    });

    it("throws if response is not ok", async () => {
      global.fetch = Object.assign(
        mock().mockResolvedValue({
          ok: false,
          status: 400,
          text: async () => "Bad request",
        }),
        { preconnect: () => {} }
      ) as any;

      await expect(generateVirtualKey("task123", "engine1", "http://test-url")).rejects.toThrow(
        "LiteLLM /key/generate failed (400): Bad request"
      );
    });

    it("throws if json has unexpected shape", async () => {
      global.fetch = Object.assign(
        mock().mockResolvedValue({
          ok: true,
          json: async () => ({}),
        }),
        { preconnect: () => {} }
      ) as any;

      await expect(generateVirtualKey("task123", "engine1", "http://test-url")).rejects.toThrow(
        "LiteLLM /key/generate returned unexpected shape"
      );
    });
  });

  describe("deleteVirtualKey", () => {
    let originalFetch: typeof global.fetch;
    const consoleWarnSpy = mock(() => {});
    let _originalConsoleWarn: typeof console.warn;

    beforeEach(() => {
      originalFetch = global.fetch;
      _originalConsoleWarn = console.warn;
      process.env.LITELLM_MASTER_KEY = "master-key";
      console.warn = consoleWarnSpy;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("deletes virtual key successfully", async () => {
      global.fetch = Object.assign(mock().mockResolvedValue({ ok: true }), {
        preconnect: () => {},
      }) as any;

      await deleteVirtualKey("tid-123", "http://test-url");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test-url/key/delete",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ keys: ["tid-123"] }),
        })
      );
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("logs warning if response is not ok", async () => {
      global.fetch = Object.assign(
        mock().mockResolvedValue({
          ok: false,
          text: async () => "Not found",
        }),
        { preconnect: () => {} }
      ) as any;

      await deleteVirtualKey("tid-123", "http://test-url");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[litellm] Failed to delete key tid-123…: Not found"
      );
    });
  });

  describe("checkLiteLLMHealth", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("returns true if health check is ok", async () => {
      global.fetch = Object.assign(mock().mockResolvedValue({ ok: true }), {
        preconnect: () => {},
      }) as any;
      expect(await checkLiteLLMHealth("http://test-url")).toBe(true);
    });

    it("returns false if health check is not ok", async () => {
      global.fetch = Object.assign(mock().mockResolvedValue({ ok: false }), {
        preconnect: () => {},
      }) as any;
      expect(await checkLiteLLMHealth("http://test-url")).toBe(false);
    });

    it("returns false if fetch throws", async () => {
      global.fetch = Object.assign(mock().mockRejectedValue(new Error("Network error")), {
        preconnect: () => {},
      }) as any;
      expect(await checkLiteLLMHealth("http://test-url")).toBe(false);
    });
  });

  describe("listLiteLLMModels", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      process.env.LITELLM_MASTER_KEY = "master-key";
      process.env.LITELLM_BASE_URL = "http://env-url";
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("lists models successfully using default base url", async () => {
      global.fetch = Object.assign(
        mock().mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ id: "model1" }, { id: "model2" }] }),
        }),
        { preconnect: () => {} }
      ) as any;

      const models = await listLiteLLMModels();
      expect(models).toEqual(["model1", "model2"]);
      expect(global.fetch).toHaveBeenCalledWith("http://env-url/v1/models", expect.any(Object));
    });

    it("lists models successfully using provided base url", async () => {
      global.fetch = Object.assign(
        mock().mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ id: "model1" }] }),
        }),
        { preconnect: () => {} }
      ) as any;

      const models = await listLiteLLMModels("http://custom-url");
      expect(models).toEqual(["model1"]);
      expect(global.fetch).toHaveBeenCalledWith("http://custom-url/v1/models", expect.any(Object));
    });

    it("returns empty array if response is not ok", async () => {
      global.fetch = Object.assign(mock().mockResolvedValue({ ok: false }), {
        preconnect: () => {},
      }) as any;
      expect(await listLiteLLMModels()).toEqual([]);
    });

    it("returns empty array if fetch throws", async () => {
      global.fetch = Object.assign(mock().mockRejectedValue(new Error("Network error")), {
        preconnect: () => {},
      }) as any;
      expect(await listLiteLLMModels()).toEqual([]);
    });

    it("returns empty array if data is missing", async () => {
      global.fetch = Object.assign(
        mock().mockResolvedValue({
          ok: true,
          json: async () => ({}),
        }),
        { preconnect: () => {} }
      ) as any;
      expect(await listLiteLLMModels()).toEqual([]);
    });
  });
});
