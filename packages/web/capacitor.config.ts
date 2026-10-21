import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.vibecode.harness",
  appName: "Harness Remote",
  webDir: "dist",
  server: {
    // http scheme lets the WebView call plain-http LAN servers without mixed-content blocks.
    androidScheme: "http",
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
