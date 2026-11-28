/**
 * Account credentials API (issue #262).
 *
 * Only connection status is returned; the secret never leaves the server.
 */
import { Hono } from "hono";
import type { Db } from "../db";
import {
  deleteAccountCredential,
  getAccountCredentialStatus,
  setAccountCredential,
} from "../security/account-credentials";
import { CREDENTIAL_KINDS, CredentialConfigError, readKeyRing } from "../security/credentials";
import { accountScope } from "./projects";

function encryptionConfigured(): boolean {
  try {
    readKeyRing();
    return true;
  } catch {
    return false;
  }
}

export function createCredentialsRouter(db: Db) {
  const router = new Hono();

  router.get("/", (c) => {
    const scope = accountScope(db, c);
    if ("error" in scope) return scope.error;
    const configured = encryptionConfigured();
    const credentials = CREDENTIAL_KINDS.map((kind) =>
      configured
        ? getAccountCredentialStatus(db, scope.accountId, kind)
        : {
            kind,
            connected: false,
            version: null,
            updatedAt: null,
            error: "Credential encryption is not configured on the server",
          }
    );
    return c.json({ data: { encryptionConfigured: configured, credentials } });
  });

  router.put("/opencode", async (c) => {
    const scope = accountScope(db, c);
    if ("error" in scope) return scope.error;
    const body = (await c.req.json().catch(() => ({}))) as { apiKey?: string };
    try {
      const status = setAccountCredential(db, scope.accountId, "opencode_go", body.apiKey ?? "");
      return c.json({ data: status });
    } catch (err) {
      if (err instanceof CredentialConfigError) {
        return c.json({ error: "credentials_not_configured", message: err.message }, 503);
      }
      return c.json({ error: "validation", message: "Credential could not be stored" }, 400);
    }
  });

  router.delete("/opencode", (c) => {
    const scope = accountScope(db, c);
    if ("error" in scope) return scope.error;
    deleteAccountCredential(db, scope.accountId, "opencode_go");
    return c.json({ data: { kind: "opencode_go", connected: false } });
  });

  return router;
}
