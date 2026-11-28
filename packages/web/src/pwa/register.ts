/**
 * Registers the Harness Remote service worker.
 *
 * Only runs for the production bundle: in dev the Vite server serves the shell
 * and a SW would fight HMR. Safe to call unconditionally.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return;

  const register = () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        // Pick up new deploys without a hard refresh on the next visit.
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              console.info("[pwa] New version available; it will apply on next launch.");
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[pwa] Service worker registration failed:", err);
      });
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
