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
  env: Record<string, string | undefined> = process.env
): Response | null {
  if (authEnabled || env.VIBE_CODE_ALLOW_UNAUTHENTICATED_REMOTE === "true") return null;
  if (isLoopbackAddress(address)) return null;
  return new Response(
    JSON.stringify({
      error: "auth_required",
      message:
        "Remote access requires authentication. Set VIBE_CODE_API_KEY or GitHub OAuth (GITHUB_OAUTH_CLIENT_ID/SECRET) on the server.",
    }),
    { status: 403, headers: { "content-type": "application/json" } }
  );
}
