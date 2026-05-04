import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

function isExpectedNetworkError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === "EPIPE" || code === "ECONNRESET" || code === "ERR_STREAM_DESTROYED";
}

function attachProxyErrorHandlers(proxy: any, label: string): void {
  proxy.on("error", (err: unknown) => {
    if (!isExpectedNetworkError(err)) {
      console.error(`[vite-proxy:${label}]`, err);
    }
  });

  proxy.on("proxyRes", (proxyRes: any, req: any, res: any) => {
    const teardown = () => {
      try {
        proxyRes.destroy();
      } catch {}
    };

    req.on("aborted", teardown);
    req.on("close", teardown);
    res.on("close", teardown);

    proxyRes.on("error", (err: unknown) => {
      if (!isExpectedNetworkError(err)) {
        console.error(`[vite-proxy:${label}:proxyRes]`, err);
      }
    });
  });
}

export default defineConfig({
  plugins: [
    {
      name: "suppress-client-socket-noise",
      configureServer(server) {
        // Ignore transient client socket disconnect errors in dev
        // so Vite does not spam stack traces while the app keeps running.
        server.httpServer?.on("clientError", (err, socket) => {
          const code = (err as { code?: string }).code;
          if (code === "EPIPE" || code === "ECONNRESET") {
            socket.destroy();
          }
        });
      },
    },
    react(),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("react-dom")) {
              return "vendor-react";
            }
            if (id.includes("@dnd-kit")) {
              return "vendor-dnd";
            }
            return "vendor";
          }
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/test/**", "src/main.tsx"],
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        timeout: 60000,
        proxyTimeout: 60000,
        configure: (proxy) => attachProxyErrorHandlers(proxy, "api"),
      },
    },
  },
});
