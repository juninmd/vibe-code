/**
 * Without authentication, anyone who can reach the port can run coding agents
 * on this machine and read their transcripts. Unauthenticated servers therefore
 * only answer loopback clients. Remote access (a phone, another machine) needs
 * VIBE_CODE_API_KEY or GitHub OAuth; VIBE_CODE_ALLOW_UNAUTHENTICATED_REMOTE=true
 * opts out (e.g. behind a VPN or an authenticating reverse proxy).
 */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const a = address.toLowerCase();
  return a === "::1" || a === "localhost" || a.startsWith("127.") || a.startsWith("::ffff:127.");
}

export function blockUnauthenticatedRemote(
  address: string | null | undefined,
  authEnabled: boolean,
  env: Record<string, string | undefined> = process.env,
  pathname = "/api"
): Response | null {
  if (authEnabled || env.VIBE_CODE_ALLOW_UNAUTHENTICATED_REMOTE === "true") return null;
  if (isLoopbackAddress(address)) return null;
  // A phone opening the app gets a readable page instead of raw JSON.
  if (!pathname.startsWith("/api") && !pathname.startsWith("/ws"))
    return new Response(BLOCKED_PAGE, {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  return new Response(
    JSON.stringify({
      error: "auth_required",
      message:
        "Remote access requires authentication. Set VIBE_CODE_API_KEY or GitHub OAuth (GITHUB_OAUTH_CLIENT_ID/SECRET) on the server.",
    }),
    { status: 403, headers: { "content-type": "application/json" } }
  );
}

const BLOCKED_PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>vibe remote</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#141414;color:#eee;font:15px/1.5 system-ui,sans-serif;padding:16px}main{max-width:420px}h1{font-size:20px}code{background:#262626;padding:1px 5px;border-radius:4px}</style></head>
<body><main><h1>Acesso remoto bloqueado</h1><p>Este servidor está sem autenticação, então só aceita conexões da própria máquina.</p>
<p>Para usar pelo celular, defina <code>VIBE_CODE_API_KEY</code> (ou o login GitHub OAuth) no servidor, reinicie e entre com a chave.</p></main></body></html>`;
