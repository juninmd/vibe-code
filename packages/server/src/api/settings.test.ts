import { describe, expect, it, mock, spyOn, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createDb } from "../db";
import { createSettingsRouter } from "./settings";

type Db = ReturnType<typeof createDb>;

function makeDb(): Db {
  const db = createDb(":memory:");
  db.settings.set("auth_enabled", "false");
  return db;
}

function buildApp(db: Db) {
  const app = new Hono();
  app.route("/api/settings", createSettingsRouter(db));
  return app;
}

describe("Settings API - MCP integration", () => {
  it("GET /api/settings defaults to providing github MCP config if github token is present", async () => {
    const db = makeDb();
    db.settings.set("github_token", "ghp_mocktokenvalue");

    const app = buildApp(db);
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.mcpServers).toBeDefined();
    expect(body.data.mcpServers.github).toBeDefined();
    expect(body.data.mcpServers.github.type).toBe("local");
    expect(body.data.mcpServers.github.environment.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
      "••••••••••••••alue"
    );
  });

  it("PUT /api/settings preserves unmasked secrets when updating settings with masked values", async () => {
    const db = makeDb();
    db.settings.set("github_token", "ghp_mocktokenvalue");

    // Set an initial MCP config with a secret
    const initialMcp = {
      customServer: {
        type: "local",
        command: ["npx", "-y", "some-mcp-server"],
        enabled: true,
        environment: {
          SECRET_API_KEY: "super_secret_value",
        },
      },
    };
    db.settings.set("mcp_servers", JSON.stringify(initialMcp));

    const app = buildApp(db);

    // Perform PUT with masked value for customServer's secret
    const putPayload = {
      mcpServers: {
        customServer: {
          type: "local",
          command: ["npx", "-y", "some-mcp-server"],
          enabled: true,
          environment: {
            SECRET_API_KEY: "••••••••value", // masked
          },
        },
      },
    };

    const putRes = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(putPayload),
    });
    expect(putRes.status).toBe(200);

    // Retrieve settings to confirm the original unmasked secret was preserved
    const getRes = await app.request("/api/settings");
    expect(getRes.status).toBe(200);

    // Verify in db directly that the unmasked value was preserved
    const dbMcpStr = db.settings.get("mcp_servers");
    expect(dbMcpStr).not.toBeNull();
    const dbMcp = JSON.parse(dbMcpStr as string);
    expect(dbMcp.customServer.environment.SECRET_API_KEY).toBe("super_secret_value");
  });
});

describe("Settings API - Additional coverage", () => {
  it("PUT /api/settings handles additional fields", async () => {
    const db = makeDb();
    const app = buildApp(db);

    const putPayload = {
      telegramEnabled: true,
      maxAgents: 10,
      theme: "light",
      githubToken: "ghp_newtoken",
      gitlabToken: "glpat_test",
      gitlabBaseUrl: "https://gitlab.custom.com",
      litellmBaseUrl: "http://custom-litellm",
      litellmEnabled: false,
      geminiApiKey: "gemini_key",
      anthropicApiKey: "anthropic_key",
      openaiApiKey: "openai_key",
      skillsPath: "/custom/skills",
      autoSweep: false,
      telegramBotToken: "tg_bot_token",
      telegramChatId: "tg_chat_id",
    };

    const putRes = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(putPayload),
    });
    expect(putRes.status).toBe(200);

    expect(db.settings.get("telegram_enabled")).toBe("true");
    expect(db.settings.get("max_agents")).toBe("10");
    expect(db.settings.get("theme")).toBe("light");
    expect(db.settings.get("github_token")).toBe("ghp_newtoken");
    expect(db.settings.get("gitlab_token")).toBe("glpat_test");
    expect(db.settings.get("gitlab_base_url")).toBe("https://gitlab.custom.com");
    expect(db.settings.get("litellm_base_url")).toBe("http://custom-litellm");
    expect(db.settings.get("litellm_enabled")).toBe("false");
    expect(db.settings.get("gemini_api_key")).toBe("gemini_key");
    expect(db.settings.get("anthropic_api_key")).toBe("anthropic_key");
    expect(db.settings.get("openai_api_key")).toBe("openai_key");
    expect(db.settings.get("skills_path")).toBe("/custom/skills");
    expect(db.settings.get("auto_sweep")).toBe("false");
    expect(db.settings.get("telegram_bot_token")).toBe("tg_bot_token");
    expect(db.settings.get("telegram_chat_id")).toBe("tg_chat_id");
  });

  it("POST /api/settings/test/telegram returns 400ish/ok:false if missing credentials", async () => {
    const db = makeDb();
    const app = buildApp(db);

    const res = await app.request("/api/settings/test/telegram", {
      method: "POST",
    });
    const body = await res.json();
    expect(body.data.ok).toBe(false);
    expect(body.data.error).toContain("Bot token and Chat ID are required");
  });

  it("POST /api/settings/test/:provider returns ok:false if provider missing token", async () => {
    const db = makeDb();

    // We mock missing token behavior since we can't easily mock registry here
    const app = buildApp(db);
    const res = await app.request("/api/settings/test/github", {
      method: "POST",
    });

    const body = await res.json();
    expect(body.data.ok).toBe(false);
    expect(body.data.error).toContain("Provider registry not available");
  });
});

describe("Settings API - Additional provider logic part 2", () => {
  it("POST /api/settings/test/:provider handles missing registry gracefully", async () => {
    const db = makeDb();
    const app = new Hono();
    // Intentionally pass undefined for registry
    app.route("/api/settings", createSettingsRouter(db, undefined as any));

    const res = await app.request("/api/settings/test/github", { method: "POST" });
    const body = await res.json();
    expect(body.data.ok).toBe(false);
    expect(body.data.error).toContain("Provider registry not available");
  });

  it("GET /api/settings sets github token if token not set but env var present", async () => {
    const originalEnv = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "env_gh_token_mock";

    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/settings");
    const body = await res.json();

    expect(body.data.github.tokenSet).toBe(true);

    process.env.GITHUB_TOKEN = originalEnv;
  });
});

  import { ProviderRegistry } from "../git/providers/registry";
import * as litellmCheck from "../agents/litellm-client";

describe("API settings extra branch coverage", () => {
    let db: any;
    let registry: any;
    let app: any;

    beforeEach(() => {
      db = createDb(":memory:");
      registry = new ProviderRegistry(db);
      app = new Hono().route("/", createSettingsRouter(db, registry));
    });

    it("PUT / updates githubToken and fetches user", async () => {
      db.settings.set("github_token", "old");
      const mockAdapter = {
        getUser: mock(async () => ({ username: "gh_user" }))
      };
      registry.get = mock((p: string) => p === "github" ? mockAdapter : undefined);

      const res = await app.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubToken: "new_token" })
      });

      expect(res.status).toBe(200);
      expect(db.settings.get("github_token")).toBe("new_token");
      expect(db.settings.get("github_username")).toBe("gh_user");

      // With exception
      mockAdapter.getUser.mockRejectedValueOnce(new Error("fail"));
      await app.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubToken: "newer_token" })
      });
      expect(db.settings.get("github_username")).toBe("gh_user"); // unchanged

      // Empty token
      await app.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubToken: "" })
      });
      expect(db.settings.get("github_username")).toBe("");
    });

    it("PUT / updates gitlabToken and fetches user", async () => {
      const mockAdapter = {
        getUser: mock(async () => ({ username: "gl_user" }))
      };
      registry.get = mock((p: string) => p === "gitlab" ? mockAdapter : undefined);
      registry.rebuildGitLab = mock(() => {});

      const res = await app.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gitlabToken: "new_token", gitlabBaseUrl: "https://new.gl" })
      });

      expect(res.status).toBe(200);
      expect(db.settings.get("gitlab_token")).toBe("new_token");
      expect(db.settings.get("gitlab_base_url")).toBe("https://new.gl");
      expect(db.settings.get("gitlab_username")).toBe("gl_user");

      // With exception
      mockAdapter.getUser.mockRejectedValueOnce(new Error("fail"));
      await app.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gitlabToken: "newer_token" })
      });
      expect(db.settings.get("gitlab_username")).toBe("gl_user"); // unchanged

      // Empty token
      await app.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gitlabToken: "" })
      });
      expect(db.settings.get("gitlab_username")).toBe("");
    });

    it("POST /test/telegram handles success and failure", async () => {
      db.settings.set("telegram_enabled", "true");
      db.settings.set("telegram_bot_token", "test_bot");
      db.settings.set("telegram_chat_id", "1234");

      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("ok") as any);

      const res1 = await app.request("/test/telegram", { method: "POST" });
      expect(res1.status).toBe(200);
      expect(await res1.json()).toEqual({ data: { ok: true } });

      fetchSpy.mockResolvedValueOnce(new Response("bad request", { status: 400 }) as any);
      const res2 = await app.request("/test/telegram", { method: "POST" });
      expect(res2.status).toBe(200);
      expect((await res2.json() as any).data.ok).toBe(false);

      fetchSpy.mockRejectedValueOnce(new Error("Network fail"));
      const res3 = await app.request("/test/telegram", { method: "POST" });
      expect(res3.status).toBe(200);
      expect((await res3.json() as any).data.ok).toBe(false);

      fetchSpy.mockRestore();
    });

    it("POST /test/:provider handles success and failure", async () => {
      const mockAdapter = {
        getUser: mock(async () => ({ username: "gh_user" }))
      };
      registry.get = mock((p: string) => p === "github" ? mockAdapter : undefined);
      registry.getToken = mock((p: string) => p === "github" ? "token" : undefined);

      const res1 = await app.request("/test/github", { method: "POST" });
      expect(res1.status).toBe(200);
      expect(await res1.json()).toEqual({ data: { ok: true, username: "gh_user" } });
      expect(db.settings.get("github_username")).toBe("gh_user");

      mockAdapter.getUser.mockRejectedValueOnce(new Error("bad token"));
      const res2 = await app.request("/test/github", { method: "POST" });
      expect(res2.status).toBe(200);
      expect((await res2.json() as any).data.ok).toBe(false);

      const res4 = await app.request("/test/gitlab", { method: "POST" });
      expect(res4.status).toBe(200);
      expect((await res4.json() as any).data.ok).toBe(false);
    });

    it("GET /litellm/health", async () => {
      db.settings.set("litellm_base_url", "http://l");

      const checkSpy = spyOn(litellmCheck, "checkLiteLLMHealth").mockResolvedValueOnce(true);

      const res = await app.request("/litellm/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { ok: true, baseUrl: "http://l" } });

      checkSpy.mockRestore();
    });

    it("PUT / handles invalid input", async () => {
      const res = await app.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxAgents: "not a number"
        })
      });

      expect(res.status).toBe(400);
      expect((await res.json() as any).error).toBe("validation");
    });
  });
