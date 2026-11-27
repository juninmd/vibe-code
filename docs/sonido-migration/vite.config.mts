import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../..", import.meta.url));

// Serves only the comparison page, with the app's real CSS and the installed design system.
export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  server: {
    port: 5303,
    strictPort: true,
    fs: { allow: [repo] },
  },
});
