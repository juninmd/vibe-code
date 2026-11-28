/**
 * Model providers for the OpenCode harness.
 *
 * OpenCode is the default harness of the remote workspace. Two providers are
 * first-class here, on top of whatever the operator already configured with
 * `opencode auth login`:
 *
 * - **OpenCode Go** (`opencode-go/*`): the OpenCode subscription. OpenCode reads
 *   its key from `OPENCODE_API_KEY` (or from its own auth store).
 * - **LiteLLM** (`litellm/*`): any OpenAI-compatible gateway, declared as a
 *   custom provider (`@ai-sdk/openai-compatible`) in the inline config passed
 *   through `OPENCODE_CONFIG_CONTENT`. The key travels in an env var and is
 *   referenced with `{env:...}`, so it never lands in argv or on disk.
 *
 * The inline config is an overlay: the user's global config, the repository's
 * own `opencode.json` and every official skill location keep working.
 */

import type { Db } from "../db";
import {
  type CustomProvider,
  readCustomProviders,
  resolveCustomProviders,
} from "./custom-providers";
import { getLiteLLMBaseUrl, listLiteLLMModels } from "./litellm-client";

export const LITELLM_PROVIDER_ID = "litellm";
export const OPENCODE_GO_PROVIDER_ID = "opencode-go";
/** Env var the inline config uses to reference the LiteLLM key. */
export const LITELLM_KEY_ENV = "VIBE_LITELLM_API_KEY";

export interface LiteLLMProviderSettings {
  enabled: boolean;
  baseUrl: string;
  /** Static key (user key or master key). A per-run virtual key takes precedence. */
  apiKey?: string;
  /** Models declared up front; the gateway's /v1/models list is merged in when reachable. */
  models: string[];
}

export interface OpenCodeProviderSettings {
  /** OpenCode Go / Zen key. Optional when the server already ran `opencode auth login`. */
  goApiKey?: string;
  litellm: LiteLLMProviderSettings;
  /** User-defined OpenAI-compatible providers (Settings → Provedores). */
  custom: CustomProvider[];
}

function splitList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

type SettingsReader = { get(key: string): string | null | undefined };

/** Read provider settings from the DB, with env vars as fallback/override. */
export function readOpenCodeProviderSettings(
  settings: SettingsReader,
  env: Record<string, string | undefined> = process.env
): OpenCodeProviderSettings {
  const goApiKey = settings.get("opencode_go_api_key")?.trim() || env.OPENCODE_API_KEY?.trim();
  const apiKey =
    settings.get("litellm_api_key")?.trim() ||
    env.LITELLM_API_KEY?.trim() ||
    env.LITELLM_MASTER_KEY?.trim();
  return {
    goApiKey: goApiKey || undefined,
    litellm: {
      enabled: settings.get("litellm_enabled") !== "false",
      baseUrl: getLiteLLMBaseUrl(settings.get("litellm_base_url")),
      apiKey: apiKey || undefined,
      models: splitList(settings.get("litellm_models") || env.LITELLM_MODELS),
    },
    custom: readCustomProviders(settings),
  };
}

let source: () => OpenCodeProviderSettings = () =>
  readOpenCodeProviderSettings({ get: () => undefined });

/** Wire the provider settings to the server DB (called once at startup). */
export function useDbForOpenCodeProviders(db: Pick<Db, "settings">): void {
  source = () => readOpenCodeProviderSettings(db.settings);
}

export function setOpenCodeProviderSource(fn: () => OpenCodeProviderSettings): void {
  source = fn;
}

export function getOpenCodeProviderSettings(): OpenCodeProviderSettings {
  return source();
}

/** OpenAI-compatible SDKs append `/chat/completions`; LiteLLM serves it under `/v1`. */
export function openAICompatibleBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function isLiteLLMModel(model: string | undefined): boolean {
  return !!model?.startsWith(`${LITELLM_PROVIDER_ID}/`);
}

/** `litellm/openai/gpt-4o#high` → `openai/gpt-4o` (the gateway model id). */
export function liteLLMModelId(model: string): string {
  return model.slice(LITELLM_PROVIDER_ID.length + 1).split("#")[0];
}

export interface LiteLLMRuntime {
  baseUrl: string;
  apiKey: string;
  models: string[];
}

/**
 * Resolve the LiteLLM provider for a run. A per-run virtual key (generated
 * with the master key) wins over the static key. Returns null when the
 * gateway is disabled or has no key.
 */
export function resolveLiteLLMRuntime(
  settings: OpenCodeProviderSettings,
  override: { apiKey?: string; baseUrl?: string } = {}
): LiteLLMRuntime | null {
  if (!settings.litellm.enabled && !override.apiKey) return null;
  const apiKey = override.apiKey || settings.litellm.apiKey;
  if (!apiKey) return null;
  return {
    baseUrl: openAICompatibleBaseUrl(override.baseUrl || settings.litellm.baseUrl),
    apiKey,
    models: settings.litellm.models,
  };
}

export interface OpenCodeOverlayInput {
  permission?: Record<string, string>;
  mcp?: Record<string, unknown>;
  litellm?: { baseUrl: string; models: string[] } | null;
  /** Ready-made `provider.<id>` entries (custom providers). */
  providers?: Record<string, unknown>;
  /** Extra SKILL.md roots (vibe-code's skill catalog). */
  skillDirs?: string[];
}

/** Build the inline OpenCode config (`OPENCODE_CONFIG_CONTENT`). */
export function buildOpenCodeOverlay(input: OpenCodeOverlayInput): Record<string, unknown> {
  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
  };
  if (input.permission) config.permission = input.permission;
  if (input.mcp && Object.keys(input.mcp).length > 0) config.mcp = input.mcp;
  const skillDirs = [...new Set((input.skillDirs ?? []).filter(Boolean))];
  if (skillDirs.length > 0) config.skills = skillDirs;
  const providers: Record<string, unknown> = { ...input.providers };
  if (input.litellm) {
    const models = [...new Set(input.litellm.models.filter(Boolean))];
    Object.assign(providers, {
      [LITELLM_PROVIDER_ID]: {
        npm: "@ai-sdk/openai-compatible",
        name: "LiteLLM",
        options: {
          baseURL: input.litellm.baseUrl,
          apiKey: `{env:${LITELLM_KEY_ENV}}`,
        },
        models: Object.fromEntries(models.map((id) => [id, { name: id }])),
      },
    });
  }
  if (Object.keys(providers).length > 0) config.provider = providers;
  return config;
}

/** Env vars that carry provider credentials to the OpenCode process. */
export function providerEnv(
  settings: OpenCodeProviderSettings,
  litellm: LiteLLMRuntime | null,
  baseEnv: Record<string, string | undefined> = process.env
): Record<string, string> {
  const env: Record<string, string> = {};
  if (settings.goApiKey && !baseEnv.OPENCODE_API_KEY) env.OPENCODE_API_KEY = settings.goApiKey;
  if (litellm) env[LITELLM_KEY_ENV] = litellm.apiKey;
  return env;
}

/**
 * Everything needed to spawn an OpenCode command (run, models, TUI) with the
 * configured providers: env vars plus the inline config.
 */
export async function openCodeProviderLaunch(
  options: {
    model?: string;
    permission?: Record<string, string>;
    mcp?: Record<string, unknown>;
    skillDirs?: string[];
    litellmKey?: string;
    litellmBaseUrl?: string;
    /** Query the gateway's /v1/models so `opencode models` can list them. */
    discoverModels?: boolean;
  } = {},
  settings: OpenCodeProviderSettings = getOpenCodeProviderSettings()
): Promise<{ env: Record<string, string>; config: Record<string, unknown> }> {
  const litellm = resolveLiteLLMRuntime(settings, {
    apiKey: options.litellmKey,
    baseUrl: options.litellmBaseUrl,
  });
  if (litellm) {
    const models = [...litellm.models];
    if (options.model && isLiteLLMModel(options.model)) models.push(liteLLMModelId(options.model));
    if (options.discoverModels) {
      models.push(
        ...(await listLiteLLMModels(litellm.baseUrl.replace(/\/v1$/, ""), litellm.apiKey))
      );
    }
    litellm.models = models;
  }
  const custom = await resolveCustomProviders(settings.custom, {
    discoverModels: options.discoverModels,
    model: options.model,
  });
  const config = buildOpenCodeOverlay({
    permission: options.permission,
    mcp: options.mcp,
    skillDirs: options.skillDirs,
    litellm,
    providers: custom.config,
  });
  return {
    env: {
      ...providerEnv(settings, litellm),
      ...custom.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    },
    config,
  };
}
