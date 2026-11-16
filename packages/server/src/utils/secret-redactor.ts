/**
 * Scrubs credentials from text that leaves the server process: agent logs
 * (persisted and streamed over WebSocket) and terminal output. Agents print
 * whatever they read — env dumps, config files, failing curl commands — and
 * those transcripts are shown on any device the operator opens the app on.
 *
 * Two layers: exact values of known secrets (vibe-code settings and secret-like
 * env vars) and well-known token shapes.
 */
import { isServerOnlyEnv } from "./agent-env";

export const REDACTED = "[REDACTED]";
const MIN_SECRET_LENGTH = 8;

const TOKEN_PATTERNS: RegExp[] = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /(\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi,
];

/** Env names whose values count as secrets even when agents may see them. */
const SECRET_ENV = /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|_KEY$|^OPENCODE_API_KEY$)/i;

type SecretSource = () => Iterable<string | null | undefined>;
const sources: SecretSource[] = [];

export function registerSecretSource(source: SecretSource): void {
  sources.push(source);
}

function envSecrets(env: Record<string, string | undefined> = process.env): string[] {
  return Object.entries(env)
    .filter(([name]) => SECRET_ENV.test(name) || isServerOnlyEnv(name, env))
    .map(([, value]) => value ?? "");
}

let cache: { at: number; values: string[] } | null = null;
function knownSecrets(): string[] {
  // Settings change rarely; re-reading them for every log line would be wasteful.
  if (cache && Date.now() - cache.at < 5_000) return cache.values;
  const values = new Set<string>();
  const add = (value: string | null | undefined) => {
    const v = value?.trim();
    if (v && v.length >= MIN_SECRET_LENGTH) values.add(v);
  };
  for (const value of envSecrets()) add(value);
  for (const source of sources) {
    try {
      for (const value of source()) add(value);
    } catch {
      /* a failing source must never break logging */
    }
  }
  // Longest first, so a secret containing another is replaced whole.
  cache = { at: Date.now(), values: [...values].sort((a, b) => b.length - a.length) };
  return cache.values;
}

export function resetSecretCache(): void {
  cache = null;
}

export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const secret of knownSecrets()) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string) =>
      typeof prefix === "string" && match.startsWith(prefix) ? `${prefix}${REDACTED}` : REDACTED
    );
  }
  return out;
}
