import { ReactQueryProvider } from "@vibe-code/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installApiKeyFetch } from "./api/client";
import ServerSetup from "./native/ServerSetup";
import { getServerUrl, installNativeFetch, isNativeApp } from "./native/server-url";
import { registerServiceWorker } from "./pwa/register";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./index.css";
import "@juninmd/sonido/styles.css";
import "./sonido-bridge.css";

const needsServerSetup = isNativeApp() && !getServerUrl();
installNativeFetch();
// Installed last so it runs first: the native wrapper then routes the request to the server.
installApiKeyFetch();

// biome-ignore lint/style/noNonNullAssertion: root element is always present in index.html
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {needsServerSetup ? (
      <ServerSetup />
    ) : (
      <ReactQueryProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </ReactQueryProvider>
    )}
  </StrictMode>
);

if (!isNativeApp()) registerServiceWorker();
