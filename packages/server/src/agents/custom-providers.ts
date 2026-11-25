/**
 * User-defined OpenAI-compatible model providers for OpenCode (a LiteLLM behind
 * its own auth, vLLM, Ollama, an internal gateway...). Each one becomes a
 * `@ai-sdk/openai-compatible` provider in the inline config, with models shown
 * as `<id>/<model>`.
 *
 * Authentication is flexible: a bearer key, a custom header (`x-litellm-api-key`,
 * `api-key`, `Authorization: Basic …`), OAuth2 client credentials (the server
 * fetches a short-lived token per run) or none. The secret travels in an env
 * var referenced with `{env:...}`, so it never lands in argv or on disk.
 */

export type CustomProviderAuth =
  | { type: "none" }
  | { type: "bearer" }
  | { type: "header"; headerName: string; prefix?: string }
  | { type: "oauth2"; tokenUrl: string; clientId: string; scope?: string };

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  auth: CustomProviderAuth;
  /** Non-secret headers sent with every request (e.g. a tenant id). */
  headers: Record<string, string>;
  /** Models declared up front; the gateway's /models list is merged in when reachable. */
  models: string[];
  /** API key, header value or OAuth2 client secret. Never returned by the API. */
  secret?: string;
}

/** Ids OpenCode or vibe-code already use; a custom provider must not shadow them. */
export const RESERVED_PROVIDER_IDS = new Set([
  "litellm",
  "opencode",
  "opencode-go",
  "anthropic",
  "openai",
  "google",
  "github-copilot",
  "amazon-bedrock",
  "azure",
  "openrouter",
  "vertex",
]);
export const CUSTOM_PROVIDER_ID = /^[a-z][a-z0-9-]{1,31}$/;

type SettingsReader = { get(key: string): string | null | undefined };

export function readCustomProviders(settings: SettingsReader): CustomProvider[] {
  try {
    const parsed = JSON.parse(settings.get("custom_providers") || "[]");
    return Array.isArray(parsed) ? (parsed as CustomProvider[]) : [];
  } catch {
    return [];
  }
}

export function customProviderSecretEnv(id: string): string {
  return `VIBE_PROVIDER_${id.toUpperCase().replace(/-/g, "_")}_SECRET`;
}

function openAIBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

interface CachedToken {
  token: string;
  expiresAt: number;
}
const tokenCache = new Map<string, CachedToken>();

/** OAuth2 client-credentials grant, cached until a minute before expiry. */
export async function clientCredentialsToken(
  auth: Extract<CustomProviderAuth, { type: "oauth2" }>,
  secret: string,
  fetchImpl: typeof fetch = fetch,
  now = Date.now()
): Promise<string> {
  const key = `${auth.tokenUrl}|${auth.clientId}|${auth.scope ?? ""}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - 60_000 > now) return cached.token;
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: auth.clientId,
    client_secret: secret,
  });
  if (auth.scope) params.set("scope", auth.scope);
  const res = await fetchImpl(auth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: params,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!res.ok || !json.access_token) throw new Error(`token endpoint answered ${res.status}`);
  tokenCache.set(key, {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 300) * 1000,
  });
  return json.access_token;
}

/** The value the provider's secret env var carries for a run. */
async function runtimeSecret(provider: CustomProvider, fetchImpl: typeof fetch) {
  if (provider.auth.type === "none" || !provider.secret) return undefined;
  if (provider.auth.type === "oauth2") {
    return clientCredentialsToken(provider.auth, provider.secret, fetchImpl);
  }
  return provider.secret;
}

/** Headers for a direct request (model discovery, connection test). */
export function requestHeaders(provider: CustomProvider, secret?: string): Record<string, string> {
  const headers: Record<string, string> = { ...provider.headers };
  if (!secret) return headers;
  if (provider.auth.type === "header") {
    headers[provider.auth.headerName] = `${provider.auth.prefix ?? ""}${secret}`;
  } else if (provider.auth.type === "bearer" || provider.auth.type === "oauth2") {
    headers.Authorization = `Bearer ${secret}`;
  }
  return headers;
}

/** The OpenCode `provider.<id>` entry; secrets are `{env:...}` references. */
export function customProviderConfig(
  provider: CustomProvider,
  models: string[],
  hasSecret: boolean
) {
  const ref = `{env:${customProviderSecretEnv(provider.id)}}`;
  const options: Record<string, unknown> = { baseURL: openAIBase(provider.baseUrl) };
  const headers: Record<string, string> = { ...provider.headers };
  if (hasSecret && provider.auth.type === "header") {
    headers[provider.auth.headerName] = `${provider.auth.prefix ?? ""}${ref}`;
  } else if (hasSecret && (provider.auth.type === "bearer" || provider.auth.type === "oauth2")) {
    options.apiKey = ref;
  }
  if (Object.keys(headers).length > 0) options.headers = headers;
  return {
    npm: "@ai-sdk/openai-compatible",
    name: provider.name,
    options,
    models: Object.fromEntries(
      [...new Set(models.filter(Boolean))].map((id) => [id, { name: id }])
    ),
  };
}

export async function listProviderModels(
  provider: CustomProvider,
  secret: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  const res = await fetchImpl(`${openAIBase(provider.baseUrl)}/models`, {
    headers: { Accept: "application/json", ...requestHeaders(provider, secret) },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`GET /models answered ${res.status}`);
  const json = (await res.json()) as { data?: { id?: string }[] };
  return (json.data ?? []).map((model) => model.id ?? "").filter(Boolean);
}

/** Provider entries + env vars for every enabled custom provider. */
export async function resolveCustomProviders(
  providers: CustomProvider[],
  options: { discoverModels?: boolean; model?: string; fetchImpl?: typeof fetch } = {}
): Promise<{ config: Record<string, unknown>; env: Record<string, string> }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const config: Record<string, unknown> = {};
  const env: Record<string, string> = {};
  await Promise.all(
    providers
      .filter((provider) => provider.enabled && CUSTOM_PROVIDER_ID.test(provider.id))
      .map(async (provider) => {
        const secret = await runtimeSecret(provider, fetchImpl).catch((err) => {
          console.warn(`[providers] ${provider.id}: ${err instanceof Error ? err.message : err}`);
          return undefined;
        });
        const models = [...provider.models];
        const prefix = `${provider.id}/`;
        if (options.model?.startsWith(prefix)) {
          models.push(options.model.slice(prefix.length).split("#")[0]);
        }
        if (options.discoverModels) {
          models.push(...(await listProviderModels(provider, secret, fetchImpl).catch(() => [])));
        }
        if (secret) env[customProviderSecretEnv(provider.id)] = secret;
        config[provider.id] = customProviderConfig(provider, models, Boolean(secret));
      })
  );
  return { config, env };
}

/** Every stored secret, for the log scrubber. */
export function customProviderSecrets(settings: SettingsReader): (string | undefined)[] {
  return readCustomProviders(settings).map((provider) => provider.secret);
}
