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
