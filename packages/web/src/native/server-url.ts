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
  ) as typeof fetch;
}