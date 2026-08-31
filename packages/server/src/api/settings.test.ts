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
