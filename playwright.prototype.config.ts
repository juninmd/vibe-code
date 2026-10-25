import { defineConfig } from "@playwright/test";
import base, { E2E } from "./playwright.config";
import { join } from "node:path";

const servers = Array.isArray(base.webServer) ? base.webServer : [];
const server = servers[0];
if (!server) throw new Error("The isolated API test server is not configured");

/** Test the candidate against the compiled UI, without changing the normal E2E harness. */
export default defineConfig({
  ...base,
  testMatch: ["prototype.spec.ts", "plugin-bulk.spec.ts", "remote-workspace.spec.ts"],
  use: { ...base.use, baseURL: E2E.serverUrl, storageState: { cookies: [], origins: [] } },
  webServer: [{ ...server, env: { ...server.env, NODE_ENV: "production", VIBE_CODE_SKILLS_PATH: join(process.env.VIBE_E2E_ROOT ?? "", "skills") } }],
});
