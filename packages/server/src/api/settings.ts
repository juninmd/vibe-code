import { Hono } from "hono";
import { z } from "zod";
import { checkLiteLLMHealth, getLiteLLMBaseUrl } from "../agents/litellm-client";
import type { Db } from "../db";
import type { ProviderRegistry } from "../git/providers/registry";
import type { SkillsLoader } from "../skills/loader";

function maskToken(token: string | null | undefined): string {
  if (!token || token.length < 5) return "";
  return "•".repeat(token.length - 4) + token.slice(-4);
}

const updateSettingsSchema = z.object({
  githubToken: z.string().optional(),
  gitlabToken: z.string().optional(),
  gitlabBaseUrl: z.string().optional(),
  litellmBaseUrl: z.string().optional(),
  litellmEnabled: z.boolean().optional(),
  geminiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  skillsPath: z.string().optional(),
  theme: z.string().optional(),
});

export function createSettingsRouter(
  db: Db,
  providerRegistry?: ProviderRegistry,
  skillsLoader?: SkillsLoader
) {
  const app = new Hono();

  // GET /api/settings — return current settings (tokens masked)
  app.get("/", (c) => {
    const ghToken = db.settings.get("github_token");
    const glToken = db.settings.get("gitlab_token");
    const glBaseUrl = db.settings.get("gitlab_base_url") || "https://gitlab.com";
    const theme = db.settings.get("theme") || "dark";
    const litellmBaseUrl = getLiteLLMBaseUrl(db.settings.get("litellm_base_url"));
    const litellmEnabled = db.settings.get("litellm_enabled") !== "false";
    const skillsPath = db.settings.get("skills_path") || "~/.agents";
    const geminiApiKey = db.settings.get("gemini_api_key");
    const anthropicApiKey = db.settings.get("anthropic_api_key");
    const openaiApiKey = db.settings.get("openai_api_key");

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
        litellm: {
          baseUrl: litellmBaseUrl,
          enabled: litellmEnabled,
        },
        apiKeys: {
          gemini: { token: maskToken(geminiApiKey), tokenSet: !!geminiApiKey },
          anthropic: { token: maskToken(anthropicApiKey), tokenSet: !!anthropicApiKey },
          openai: { token: maskToken(openaiApiKey), tokenSet: !!openaiApiKey },
        },
        skillsPath,
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
    if (parsed.data.litellmBaseUrl !== undefined) {
      db.settings.set("litellm_base_url", parsed.data.litellmBaseUrl.trim());
    }
    if (parsed.data.litellmEnabled !== undefined) {
      db.settings.set("litellm_enabled", parsed.data.litellmEnabled ? "true" : "false");
    }
    if (parsed.data.geminiApiKey !== undefined) {
      db.settings.set("gemini_api_key", parsed.data.geminiApiKey.trim());
    }
    if (parsed.data.anthropicApiKey !== undefined) {
      db.settings.set("anthropic_api_key", parsed.data.anthropicApiKey.trim());
    }
    if (parsed.data.openaiApiKey !== undefined) {
      db.settings.set("openai_api_key", parsed.data.openaiApiKey.trim());
    }
    if (parsed.data.skillsPath !== undefined) {
      const trimmed = parsed.data.skillsPath.trim();
      db.settings.set("skills_path", trimmed);
      skillsLoader?.updatePath(trimmed);
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

  // GET /api/settings/litellm/health — proxy to LiteLLM health endpoint
  app.get("/litellm/health", async (c) => {
    const baseUrl = getLiteLLMBaseUrl(db.settings.get("litellm_base_url"));
    const healthy = await checkLiteLLMHealth(baseUrl);
    return c.json({ data: { ok: healthy, baseUrl } });
  });

  return app;
}
