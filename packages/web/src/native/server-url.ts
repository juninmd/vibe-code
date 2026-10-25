/** Storage key for the server URL used by the Android (Capacitor) shell. */
const SERVER_URL_STORAGE = "harness-remote-server-url";

/** True when running inside the Capacitor native shell (Android). */
export function isNativeApp(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/** Normalise user input ("192.168.0.10:3000") into an origin without trailing slash. */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function getServerUrl(): string | null {
  try {
    return localStorage.getItem(SERVER_URL_STORAGE);
  } catch {
    return null;
  }
}

export function setServerUrl(url: string | null): void {
  try {
    if (url) localStorage.setItem(SERVER_URL_STORAGE, url);
    else localStorage.removeItem(SERVER_URL_STORAGE);
  } catch {
    /* storage unavailable */
  }
}

/** WebSocket origin for the configured server, or null on the web build. */
export function getNativeWsOrigin(): string | null {
  if (!isNativeApp()) return null;
  const url = getServerUrl();
  return url ? url.replace(/^http/i, "ws") : null;
}

/**
 * In the native shell the page origin is the WebView itself, so relative
 * `/api/...` calls must be sent to the configured server instead. Patching
 * `fetch` once keeps every existing call site (client.ts, core hooks) working.
 */
export function installNativeFetch(): void {
  if (!isNativeApp()) return;
  const server = getServerUrl();
  if (!server) return;
  const original = window.fetch.bind(window);
  window.fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === "string" && input.startsWith("/api")) {
        return original(`${server}${input}`, init);
      }
      return original(input, init);
    },
    { preconnect: window.fetch.preconnect }
  ) as typeof fetch;
}
