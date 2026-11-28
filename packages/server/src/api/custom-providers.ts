/** /api/providers/custom — CRUD for user-defined OpenAI-compatible providers. */
import type { CustomProviderView } from "@vibe-code/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  CUSTOM_PROVIDER_ID,
  type CustomProvider,
  clientCredentialsToken,
  listProviderModels,
  RESERVED_PROVIDER_IDS,
  readCustomProviders,
} from "../agents/custom-providers";
import type { Db } from "../db";

const MAX_PROVIDERS = 20;
const httpUrl = z
  .string()
  .trim()
  .url()
  .max(512)
  .refine((value) => /^https?:\/\//i.test(value), "Use http(s)://");
const headerName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{1,64}$/, "Nome de header inválido");

const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer") }),
  z.object({
    type: z.literal("header"),
    headerName,
    prefix: z.string().max(32).optional(),
  }),
  z.object({
    type: z.literal("oauth2"),
    tokenUrl: httpUrl,
    clientId: z.string().trim().min(1).max(256),
    scope: z.string().trim().max(512).optional(),
  }),
]);

const providerSchema = z.object({
  name: z.string().trim().min(1).max(64),
  baseUrl: httpUrl,
  enabled: z.boolean().default(true),
  auth: authSchema,
  headers: z.record(headerName, z.string().max(1024)).default({}),
  models: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
  /** Omitted or empty keeps the stored secret; `null` removes it. */
  secret: z.string().max(8192).nullable().optional(),
});

function toView(provider: CustomProvider): CustomProviderView {
  const { secret, ...rest } = provider;
  return { ...rest, secretSet: Boolean(secret) };
}

function save(db: Db, providers: CustomProvider[]): void {
  db.settings.set("custom_providers", JSON.stringify(providers));
}

function idParam(c: Context): string | null {
  const id = c.req.param("id") ?? "";
  return CUSTOM_PROVIDER_ID.test(id) && !RESERVED_PROVIDER_IDS.has(id) ? id : null;
}

export function createCustomProvidersRouter(db: Db, fetchImpl: typeof fetch = fetch) {
  const app = new Hono();

  app.get("/", (c) => c.json({ data: readCustomProviders(db.settings).map(toView) }));

  app.put("/:id", async (c) => {
    const id = idParam(c);
    if (!id) {
      return c.json(
        {
          error: "validation",
          message: "Id: minúsculas, números e hífen; não pode ser reservado.",
        },
        400
      );
    }
    const parsed = providerSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.issues[0]?.message }, 400);
    }
    const providers = readCustomProviders(db.settings);
    const index = providers.findIndex((provider) => provider.id === id);
    if (index < 0 && providers.length >= MAX_PROVIDERS) {
      return c.json({ error: "limit", message: `Máximo de ${MAX_PROVIDERS} provedores.` }, 400);
    }
    const { secret, ...fields } = parsed.data;
    const previous = index >= 0 ? providers[index].secret : undefined;
    const next: CustomProvider = {
      id,
      ...fields,
      secret: secret === null ? undefined : secret?.trim() || previous,
    };
    if (index >= 0) providers[index] = next;
    else providers.push(next);
    save(db, providers);
    return c.json({ data: toView(next) });
  });

  app.delete("/:id", (c) => {
    const id = idParam(c);
    const providers = readCustomProviders(db.settings);
    const remaining = providers.filter((provider) => provider.id !== id);
    if (!id || remaining.length === providers.length) return c.json({ error: "not_found" }, 404);
    save(db, remaining);
    return c.json({ data: { ok: true } });
  });

  // POST /:id/test — authenticate and list the gateway's models.
  app.post("/:id/test", async (c) => {
    const id = idParam(c);
    const provider = readCustomProviders(db.settings).find((item) => item.id === id);
    if (!provider) return c.json({ error: "not_found" }, 404);
    try {
      const secret =
        provider.auth.type === "oauth2" && provider.secret
          ? await clientCredentialsToken(provider.auth, provider.secret, fetchImpl)
          : provider.secret;
      const models = await listProviderModels(provider, secret, fetchImpl);
      return c.json({ data: { ok: true, models } });
    } catch (err) {
      return c.json({
        data: { ok: false, models: [], error: err instanceof Error ? err.message : String(err) },
      });
    }
  });

  return app;
}
