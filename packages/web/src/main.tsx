import { ReactQueryProvider } from "@vibe-code/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ServerSetup from "./native/ServerSetup";
import { getServerUrl, installNativeFetch, isNativeApp } from "./native/server-url";
import { registerServiceWorker } from "./pwa/register";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./index.css";

const needsServerSetup = isNativeApp() && !getServerUrl();
installNativeFetch();

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
