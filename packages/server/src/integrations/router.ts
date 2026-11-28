/**
 * /api/integrations — authenticate the default MCP providers (Settings → MCP).
 * Mounted behind the auth middleware; the OAuth callbacks live under /api/auth.
 */
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";
import { type DefaultMcpId, mcpConnectionStatus } from "../mcp/default-servers";
import { createLoginUrl, isGitHubOAuthConfigured } from "../oauth/github";
import type { ConnectFlows } from "./connect-flows";
import { fetchGitLabUsername, startGitLabConnect, storeGitLabPersonalToken } from "./gitlab-oauth";

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(512)
  .refine((value) => /^https?:\/\//i.test(value), "Use http(s)://")
  .transform((value) => value.replace(/\/+$/, ""));

const gitlabTokenSchema = z.object({
  token: z.string().trim().min(8).max(512),
  baseUrl: httpUrl.optional(),
});
const gitlabAppSchema = z.object({
  clientId: z.string().trim().min(1).max(256),
  clientSecret: z.string().trim().max(512).optional(),
  baseUrl: httpUrl.optional(),
});
const enabledSchema = z.object({ enabled: z.boolean() });
const mcpId = z.enum(["github", "gitlab", "playwright", "context7"]);
const authMcpId = z.enum(["github", "gitlab"]);

async function body<T>(c: Context, schema: z.ZodType<T>) {
  return schema.safeParse(await c.req.json().catch(() => null));
}

function invalid(c: Context, error: z.ZodError) {
  return c.json({ error: "validation", message: error.issues[0]?.message ?? "Invalid" }, 400);
}

export function createIntegrationsRouter(
  db: Db,
  flows: ConnectFlows,
  fetchImpl: typeof fetch = fetch
) {
  const app = new Hono();

  app.get("/mcp", (c) => c.json({ data: mcpConnectionStatus(db.settings) }));

  app.put("/mcp/:id/enabled", async (c) => {
    const id = mcpId.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "not_found" }, 404);
    const parsed = await body(c, enabledSchema);
    if (!parsed.success) return invalid(c, parsed.error);
    db.settings.set(`mcp_default_${id.data}_enabled`, parsed.data.enabled ? "true" : "false");
    return c.json({ data: mcpConnectionStatus(db.settings) });
  });

  app.post("/github/connect", (c) => {
    if (!isGitHubOAuthConfigured()) {
      return c.json(
        { error: "oauth_not_configured", message: "GitHub OAuth app is not configured." },
        409
      );
    }
    const state = flows.create({ provider: "github" });
    return c.json({ data: { url: createLoginUrl(c, state) } });
  });

  app.post("/gitlab/connect", (c) => {
    const url = startGitLabConnect(db, c, flows);
    if (!url) {
      return c.json(
        { error: "oauth_not_configured", message: "GitLab OAuth application is not configured." },
        409
      );
    }
    return c.json({ data: { url } });
  });

  app.put("/gitlab/token", async (c) => {
    const parsed = await body(c, gitlabTokenSchema);
    if (!parsed.success) return invalid(c, parsed.error);
    const baseUrl =
      parsed.data.baseUrl ?? (db.settings.get("gitlab_base_url") || "https://gitlab.com");
    const username = await fetchGitLabUsername(baseUrl, parsed.data.token, fetchImpl).catch(
      () => undefined
    );
    if (!username) {
      return c.json(
        { error: "token_rejected", message: `O GitLab em ${baseUrl} recusou o token.` },
        400
      );
    }
    db.settings.set("gitlab_base_url", baseUrl);
    storeGitLabPersonalToken(db.settings, parsed.data.token);
    db.settings.set("gitlab_username", username);
    return c.json({ data: mcpConnectionStatus(db.settings) });
  });

  app.put("/gitlab/oauth-app", async (c) => {
    const parsed = await body(c, gitlabAppSchema);
    if (!parsed.success) return invalid(c, parsed.error);
    if (parsed.data.baseUrl) db.settings.set("gitlab_base_url", parsed.data.baseUrl);
    db.settings.set("gitlab_oauth_client_id", parsed.data.clientId);
    if (parsed.data.clientSecret) {
      db.settings.set("gitlab_oauth_client_secret", parsed.data.clientSecret);
    }
    return c.json({ data: mcpConnectionStatus(db.settings) });
  });

  app.delete("/:id", (c) => {
    const id = authMcpId.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "not_found" }, 404);
    const provider: DefaultMcpId = id.data;
    if (provider === "github") {
      db.settings.set("github_token", "");
      db.settings.set("github_username", "");
    } else {
      storeGitLabPersonalToken(db.settings, "");
      db.settings.set("gitlab_username", "");
    }
    return c.json({ data: mcpConnectionStatus(db.settings) });
  });

  return app;
}
