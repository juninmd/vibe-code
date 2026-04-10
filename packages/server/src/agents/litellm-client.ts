/**
 * LiteLLM Proxy client.
 *
 * Responsibilities:
 * - Resolve the proxy base URL (env var → DB setting)
 * - Create per-task virtual keys via POST /key/generate
 * - Delete virtual keys via POST /key/delete
 *
 * The LITELLM_MASTER_KEY is read from the environment only. It is NEVER
 * returned to the UI or stored in the database.
 */

export interface VirtualKey {
  key: string;
  tokenId: string;
}

export function getLiteLLMBaseUrl(dbBaseUrl?: string | null): string {
  return process.env.LITELLM_BASE_URL?.trim() || dbBaseUrl?.trim() || "http://localhost:4000";
}

function getMasterKey(): string {
  const key = process.env.LITELLM_MASTER_KEY?.trim();
  if (!key) throw new Error("LITELLM_MASTER_KEY is not set");
  return key;
}

/**
 * Generate a short-lived virtual key scoped to one agent run.
 * The key is tagged with metadata so spend appears per-task in the dashboard.
 */
export async function generateVirtualKey(
  taskId: string,
  engine: string,
  baseUrl: string
): Promise<VirtualKey> {
  const masterKey = getMasterKey();

  const res = await fetch(`${baseUrl}/key/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${masterKey}`,
    },
    body: JSON.stringify({
      // No expiry — we delete the key ourselves in the finally block.
      metadata: { task_id: taskId, engine, created_by: "vibe-code" },
      // Tag the key so it appears grouped in the LiteLLM dashboard
      tags: [`task:${taskId.slice(0, 8)}`, `engine:${engine}`],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LiteLLM /key/generate failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { key?: string; token?: string; token_id?: string };

  const key = json.key ?? json.token;
  const tokenId = json.token_id ?? json.token;

  if (!key || !tokenId) {
    throw new Error("LiteLLM /key/generate returned unexpected shape");
  }

  return { key, tokenId };
}

/**
 * Delete a virtual key by its token_id.
 * Called in the `finally` block of every agent run to prevent key leakage.
 */
export async function deleteVirtualKey(tokenId: string, baseUrl: string): Promise<void> {
  const masterKey = getMasterKey();

  const res = await fetch(`${baseUrl}/key/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${masterKey}`,
    },
    body: JSON.stringify({ keys: [tokenId] }),
  });

  if (!res.ok) {
    // Log but don't throw — best effort, key will eventually expire
    const text = await res.text().catch(() => "");
    console.warn(`[litellm] Failed to delete key ${tokenId.slice(0, 8)}…: ${text}`);
  }
}

/**
 * Check proxy health. Returns true if the proxy responds with 200.
 */
export async function checkLiteLLMHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health/liveliness`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * List models available in the LiteLLM proxy.
 *
 * Without a model_list in litellm.config.yaml, LiteLLM auto-routes requests
 * using env-based provider keys. Models appear in /v1/models as they are used
 * (stored in DB via store_model_in_db: true).
 *
 * Returns an empty array if the proxy is unreachable or the list is empty.
 */
export async function listLiteLLMModels(baseUrl?: string): Promise<string[]> {
  const url = baseUrl ?? getLiteLLMBaseUrl();
  try {
    const masterKey = getMasterKey();
    const res = await fetch(`${url}/v1/models`, {
      headers: { Authorization: `Bearer ${masterKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => m.id).filter(Boolean);
  } catch {
    return [];
  }
}
