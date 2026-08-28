import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createDb } from "../db";
import { createSettingsRouter } from "./settings";

type Db = ReturnType<typeof createDb>;

function makeDb(): Db {
  const db = createDb(":memory:");
  db.settings.set("auth_enabled", "false");
  return db;
}

function buildApp(db: Db, registry: any = undefined) {
  const app = new Hono();
  app.route("/api/settings", createSettingsRouter(db, registry));
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
describe("PUT /api/settings", () => {
  it("validates input", async () => {
    const res = await buildApp(makeDb()).request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxAgents: "invalid" }),
    });
    expect(res.status).toBe(400);
  });

  it("updates settings", async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        githubToken: "gh_token",
        gitlabToken: "gl_token",
        gitlabBaseUrl: "https://gitlab.example.com",
        litellmBaseUrl: "http://localhost:4000",
        litellmEnabled: true,
        geminiApiKey: "gemini_key",
        anthropicApiKey: "anthropic_key",
        openaiApiKey: "openai_key",
        skillsPath: "/path/to/skills",
        theme: "dark",
        maxAgents: 5,
        autoSweep: true,
        telegramBotToken: "bot_token",
        telegramChatId: "chat_id",
        telegramEnabled: true
      }),
    });

    expect(res.status).toBe(200);
    expect(db.settings.get("github_token")).toBe("gh_token");
    expect(db.settings.get("gitlab_token")).toBe("gl_token");
    expect(db.settings.get("gitlab_base_url")).toBe("https://gitlab.example.com");
    expect(db.settings.get("litellm_base_url")).toBe("http://localhost:4000");
    expect(db.settings.get("litellm_enabled")).toBe("true");
    expect(db.settings.get("gemini_api_key")).toBe("gemini_key");
    expect(db.settings.get("anthropic_api_key")).toBe("anthropic_key");
    expect(db.settings.get("openai_api_key")).toBe("openai_key");
    expect(db.settings.get("skills_path")).toBe("/path/to/skills");
    expect(db.settings.get("theme")).toBe("dark");
    expect(db.settings.get("max_agents")).toBe("5");
    expect(db.settings.get("auto_sweep")).toBe("true");
    expect(db.settings.get("telegram_bot_token")).toBe("bot_token");
    expect(db.settings.get("telegram_chat_id")).toBe("chat_id");
    expect(db.settings.get("telegram_enabled")).toBe("true");
  });
});

describe("GET /api/settings", () => {
  it("returns current settings masking sensitive data", async () => {
    const db = makeDb();
    const app = buildApp(db);

    db.settings.set("github_token", "github_token_secret");
    db.settings.set("gemini_api_key", "gemini_key_secret");

    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.data.github.token).toBe("•".repeat(15) + "cret");
    expect(body.data.apiKeys.gemini.token).toBe("•".repeat(13) + "cret");
  });
});

describe("POST /api/settings/test/telegram", () => {
  it("returns error if missing config", async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/settings/test/telegram", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.ok).toBe(false);
    expect(json.data.error).toBe("Bot token and Chat ID are required");
  });

  it("handles valid config but failing fetch", async () => {
    const db = makeDb();
    db.settings.set("telegram_enabled", "true");
    db.settings.set("telegram_bot_token", "fake_token");
    db.settings.set("telegram_chat_id", "fake_chat");
    const app = buildApp(db);

    // Global fetch is mocked or will fail
    // We expect ok to be false
    const res = await app.request("/api/settings/test/telegram", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.ok).toBe(false);
  });
});


describe("PUT /api/settings - Edge cases", () => {
  it("ignores unspecified fields", async () => {
    const db = makeDb();
    db.settings.set("theme", "light");
    const app = buildApp(db);

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(db.settings.get("theme")).toBe("light");
  });

  it("handles empty strings", async () => {
    const db = makeDb();
    const app = buildApp(db);

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        githubToken: "",
        gitlabToken: "",
        litellmBaseUrl: "",
      }),
    });

    expect(res.status).toBe(200);
    expect(db.settings.get("github_token")).toBe("");
    expect(db.settings.get("gitlab_token")).toBe("");
    expect(db.settings.get("litellm_base_url")).toBe("");
  });
});
describe("PUT /api/settings - provider user fetching", () => {
  it("handles empty db.settings.get properly", async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
  });
  it("handles missing provider adapters gracefully", async () => {
    const db = makeDb();
    const app = buildApp(db, { get: () => undefined }); // Returns undefined adapter

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        githubToken: "gh_token",
        gitlabToken: "gl_token",
      }),
    });

    expect(res.status).toBe(200);
    // Since adapter was undefined, no username is set but it should not crash
    expect(db.settings.get("github_username")).toBeNull();
    expect(db.settings.get("gitlab_username")).toBeNull();
  });

  it("handles provider get user errors gracefully", async () => {
    const db = makeDb();
    const mockProvider = {
      get: () => ({
        getUser: async () => { throw new Error("fetch error"); }
      })
    };
    const app = buildApp(db, mockProvider as any);

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        githubToken: "gh_token",
        gitlabToken: "gl_token",
      }),
    });

    expect(res.status).toBe(200);
    // Should catch the error and continue
    expect(db.settings.get("github_username")).toBeNull();
    expect(db.settings.get("gitlab_username")).toBeNull();
  });

  it("handles provider setting empty tokens", async () => {
    const db = makeDb();
    db.settings.set("github_username", "olduser");
    const mockProvider = {
      get: () => ({
        getUser: async () => ({ username: "newuser" })
      })
    };
    const app = buildApp(db, mockProvider as any);

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        githubToken: "",
        gitlabToken: "",
      }),
    });

    expect(res.status).toBe(200);
    // Setting an empty token should clear the username
    expect(db.settings.get("github_username")).toBe("");
    expect(db.settings.get("gitlab_username")).toBe("");
  });
});
describe("POST /api/settings/test/telegram - valid request", () => {
  it("handles valid config and successful fetch", async () => {
    const db = makeDb();
    db.settings.set("telegram_enabled", "true");
    db.settings.set("telegram_bot_token", "fake_token");
    db.settings.set("telegram_chat_id", "fake_chat");
    const app = buildApp(db);

    // We'll mock fetch to return ok: true
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({}) }) as any;

    try {
      const res = await app.request("/api/settings/test/telegram", { method: "POST" });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.data.ok).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles valid config and unsuccessful fetch", async () => {
    const db = makeDb();
    db.settings.set("telegram_enabled", "true");
    db.settings.set("telegram_bot_token", "fake_token");
    db.settings.set("telegram_chat_id", "fake_chat");
    const app = buildApp(db);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => "Bad Request" }) as any;

    try {
      const res = await app.request("/api/settings/test/telegram", { method: "POST" });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.data.ok).toBe(false);
      expect(json.data.error).toBe("Telegram API error 400: Bad Request");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
describe("POST /api/settings/test/telegram - catch block", () => {
  it("handles fetch errors throwing gracefully", async () => {
    const db = makeDb();
    db.settings.set("telegram_enabled", "true");
    db.settings.set("telegram_bot_token", "fake_token");
    db.settings.set("telegram_chat_id", "fake_chat");
    const app = buildApp(db);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("Network error"); }) as any;

    try {
      const res = await app.request("/api/settings/test/telegram", { method: "POST" });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.data.ok).toBe(false);
      expect(json.data.error).toBe("Network error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
describe("POST /api/settings/test/:provider", () => {
  it("returns error if missing provider registry", async () => {
    const db = makeDb();
    const app = buildApp(db);
    const res = await app.request("/api/settings/test/github", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.ok).toBe(false);
    expect(json.data.error).toBe("Provider registry not available");
  });

  it("handles valid provider", async () => {
    const db = makeDb();
    const app = buildApp(db, { get: () => ({ getUser: async () => ({ username: "testuser" }) }), getToken: () => "token" });
    const res = await app.request("/api/settings/test/github", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.ok).toBe(true);
    expect(json.data.username).toBe("testuser");
  });

  it("handles provider failure", async () => {
    const db = makeDb();
    const app = buildApp(db, { get: () => ({ getUser: async () => { throw new Error("fetch failed"); } }), getToken: () => "token" });
    const res = await app.request("/api/settings/test/github", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.ok).toBe(false);
  });
});
describe("GET /api/settings/litellm/health", () => {
  it("proxies litellm health check", async () => {
    const db = makeDb();
    const app = buildApp(db);

    // We expect it to return ok: false because there's no actual LiteLLM running during the test
    const res = await app.request("/api/settings/litellm/health");
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.ok).toBe(false);
  });
});

describe("PUT /api/settings - Masked MCP Logic", () => {
  it("ignores masking string (•) and restores original values for tokens in mcpServers", async () => {
    const db = makeDb();
    const app = buildApp(db);

    const initialMcp = {
      testServer: {
        type: "local",
        command: ["npx", "something"],
        environment: {
          API_KEY: "original_api_key_value"
        }
      }
    };
    db.settings.set("mcp_servers", JSON.stringify(initialMcp));

    const putPayload = {
      mcpServers: {
        testServer: {
          type: "local",
          command: ["npx", "something"],
          environment: {
            API_KEY: "••••••••••••value"
          }
        }
      }
    };

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(putPayload)
    });

    expect(res.status).toBe(200);

    const updatedMcpStr = db.settings.get("mcp_servers") || "";
    const updatedMcp = JSON.parse(updatedMcpStr);
    expect(updatedMcp.testServer.environment.API_KEY).toBe("original_api_key_value");
  });
});
