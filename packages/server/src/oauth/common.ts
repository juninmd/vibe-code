/** Helpers shared by every OAuth flow (GitHub/Google login, GitHub/GitLab connect). */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** PKCE S256 pair (RFC 7636). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken();
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function isSecureCookie(c: Context): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    c.req.header("x-forwarded-proto") === "https" ||
    new URL(c.req.url).protocol === "https:"
  );
}

export function publicBaseUrl(c: Context): string {
  const configured = process.env.VIBE_CODE_PUBLIC_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto") || url.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") || c.req.header("host") || url.host;
  return `${proto}://${host}`;
}

export function csvSet(value: string | undefined): Set<string> {
  return new Set(
    (value || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

interface PendingFlow<T> {
  data: T;
  expiresAt: number;
}

const FLOW_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 100;

/**
 * One-time OAuth `state` values created by an authenticated call (connect
 * flows). The callback is public, so only a state minted here may store a token.
 */
export class PendingFlows<T> {
  private flows = new Map<string, PendingFlow<T>>();

  constructor(private now: () => number = Date.now) {}

  create(data: T): string {
    this.prune();
    if (this.flows.size >= MAX_PENDING) {
      const oldest = this.flows.keys().next().value;
      if (oldest) this.flows.delete(oldest);
    }
    const state = randomToken();
    this.flows.set(state, { data, expiresAt: this.now() + FLOW_TTL_MS });
    return state;
  }

  /** Returns the flow once; a second call with the same state gets null. */
  take(state: string | undefined): T | null {
    if (!state) return null;
    const flow = this.flows.get(state);
    this.flows.delete(state);
    if (!flow || flow.expiresAt < this.now()) return null;
    return flow.data;
  }

  private prune(): void {
    const now = this.now();
    for (const [state, flow] of this.flows) if (flow.expiresAt < now) this.flows.delete(state);
  }
}
