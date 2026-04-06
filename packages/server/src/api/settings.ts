import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";
import type { ProviderRegistry } from "../git/providers/registry";

function maskToken(token: string | null | undefined): string {
  if (!token || token.length < 5) return "";
  return "•".repeat(token.length - 4) + token.slice(-4);
}

const updateSettingsSchema = z.object({
  githubToken: z.string().optional(),
  gitlabToken: z.string().optional(),
  gitlabBaseUrl: z.string().optional(),
  theme: z.string().optional(),
});

export function createSettingsRouter(db: Db, providerRegistry?: ProviderRegistry) {
  const app = new Hono();

  // GET /api/settings — return current settings (tokens masked)
  app.get("/", (c) => {
    const ghToken = db.settings.get("github_token");
    const glToken = db.settings.get("gitlab_token");
    const glBaseUrl = db.settings.get("gitlab_base_url") || "https://gitlab.com";
    const theme = db.settings.get("theme") || "dark";

    return c.json({
      data: {
        github: {
          token: maskToken(ghToken),
          tokenSet: !!ghToken,
          username: db.settings.get("github_username") || undefined,
        },
        gitlab: {
          token: maskToken(glToken),
          tokenSet: !!glToken,
          baseUrl: glBaseUrl,
          username: db.settings.get("gitlab_username") || undefined,
        },
        theme,
        // Legacy compat
        githubToken: maskToken(ghToken),
        githubTokenSet: !!ghToken,
      },
    });
  });

  // PUT /api/settings — update settings
  app.put("/", async (c) => {
    const body = await c.req.json();
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }
    if (parsed.data.githubToken !== undefined) {
      db.settings.set("github_token", parsed.data.githubToken);
      // Auto-fetch username if token is set
      if (parsed.data.githubToken && providerRegistry) {
        try {
          const adapter = providerRegistry.get("github");
          if (adapter) {
            const user = await adapter.getUser(parsed.data.githubToken);
            db.settings.set("github_username", user.username);
          }
        } catch {
          /* best effort */
        }
      } else {
        db.settings.set("github_username", "");
      }
    }
    if (parsed.data.gitlabToken !== undefined) {
      db.settings.set("gitlab_token", parsed.data.gitlabToken);
      // Auto-fetch username if token is set
      if (parsed.data.gitlabToken && providerRegistry) {
        try {
          const adapter = providerRegistry.get("gitlab");
          if (adapter) {
            const user = await adapter.getUser(parsed.data.gitlabToken);
            db.settings.set("gitlab_username", user.username);
          }
        } catch {
          /* best effort */
        }
      } else {
        db.settings.set("gitlab_username", "");
      }
    }
    if (parsed.data.gitlabBaseUrl !== undefined) {
      db.settings.set("gitlab_base_url", parsed.data.gitlabBaseUrl);
      if (providerRegistry) providerRegistry.rebuildGitLab();
    }
    if (parsed.data.theme !== undefined) {
      db.settings.set("theme", parsed.data.theme);
    }
    return c.json({ data: { ok: true } });
  });

  // POST /api/settings/test/:provider — test connection for a provider
  app.post("/test/:provider", async (c) => {
    const provider = c.req.param("provider") as "github" | "gitlab";
    if (!providerRegistry) {
      return c.json({ data: { ok: false, error: "Provider registry not available" } });
    }
    const adapter = providerRegistry.get(provider);
    const token = providerRegistry.getToken(provider);
    if (!adapter || !token) {
      return c.json({ data: { ok: false, error: `No token configured for ${provider}` } });
    }
    try {
      const user = await adapter.getUser(token);
      db.settings.set(`${provider}_username`, user.username);
      return c.json({ data: { ok: true, username: user.username } });
    } catch (err: any) {
      return c.json({ data: { ok: false, error: err.message || String(err) } });
    }
  });

  return app;
}
