import { ReactQueryProvider } from "@vibe-code/core";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerServiceWorker } from "./pwa/register";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./index.css";

const UnifiedRemotePrototype = lazy(
  () => import("./prototypes/unified-remote/UnifiedRemotePrototype")
);
const prototype = window.location.pathname.replace(/\/$/, "") === "/prototype";

// biome-ignore lint/style/noNonNullAssertion: root element is always present in index.html
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReactQueryProvider>
      <ThemeProvider>
        {prototype ? (
          <Suspense
            fallback={
              <div role="status" className="p-6 text-secondary">
                Abrindo protótipo…
              </div>
            }
          >
            <UnifiedRemotePrototype />
          </Suspense>
        ) : (
          <App />
        )}
      </ThemeProvider>
    </ReactQueryProvider>
  </StrictMode>
);

registerServiceWorker();
