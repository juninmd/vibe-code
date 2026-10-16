import { hostname } from "node:os";

/**
 * Session names for the remote-control surface.
 *
 * In the simplified "code mode" the operator only types a task; the harness
 * derives the session name from that text, the same way Claude Code Remote
 * Control names a session `<prefix>-<slug>` when no explicit title is given.
 */

const MAX_SLUG_WORDS = 6;
const MAX_SLUG_CHARS = 48;

/** Characters allowed inside the generated slug. */
const SLUG_ALLOWED = /[^a-z0-9]+/g;

/**
 * Reduce arbitrary prompt text (markdown, code fences, paths) to a short,
 * lowercase, dash-separated slug. Returns an empty string when nothing usable
 * remains, so callers can fall back to a random name.
 */
export function slugifySessionText(text: string): string {
  const firstMeaningfulLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !/^```/.test(line)) ?? "";

  const stripped = firstMeaningfulLine
    // Drop markdown emphasis/heading/quote/list markers and inline code ticks.
    .replace(/^#+\s*/, "")
    .replace(/^[>*\-+]\s*/, "")
    .replace(/[`*_~]/g, "")
    // Keep the meaningful half of a "foo: bar" instruction.
    .trim();

  const slug = stripped
    .toLowerCase()
    .replace(SLUG_ALLOWED, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!slug) return "";

  const words = slug.split("-").filter(Boolean).slice(0, MAX_SLUG_WORDS);
  let result = words.join("-");
  if (result.length > MAX_SLUG_CHARS) {
    result = result
      .slice(0, MAX_SLUG_CHARS)
      .replace(/-+$/, "")
      .replace(/-[^-]*$/, "");
  }
  return result;
}

/**
 * Prefix used for derived session names. Operators can pin it with
 * `VIBE_CODE_SESSION_NAME_PREFIX`; otherwise we fall back to the machine
 * hostname (like Claude Code) and finally to a stable default.
 */
export function sessionNamePrefix(): string {
  const configured = process.env.VIBE_CODE_SESSION_NAME_PREFIX?.trim();
  if (configured) return slugifySessionText(configured) || configured;
  const host = hostname().trim();
  const slug = slugifySessionText(host);
  return slug || "harness";
}

/**
 * Derive a session name from the first prompt. Falls back to a random
 * `adjective-noun` pair (Claude-Code style) when the prompt has no usable text.
 */
export function deriveSessionTitle(description?: string | null): string {
  const prefix = sessionNamePrefix();
  const slug = description ? slugifySessionText(description) : "";
  const base = slug || randomCodename();
  const name = `${prefix}-${base}`;
  // Keep the stored title within a sane bound.
  return name.length > 80 ? name.slice(0, 80).replace(/-+$/, "") : name;
}

const ADJECTIVES = [
  "graceful",
  "brisk",
  "clever",
  "quiet",
  "amber",
  "swift",
  "bold",
  "nimble",
  "candid",
  "vivid",
  "stellar",
  "lucid",
];

const NOUNS = [
  "otter",
  "comet",
  "harbor",
  "lynx",
  "ember",
  "falcon",
  "willow",
  "cobalt",
  "summit",
  "pixel",
  "nebula",
  "quartz",
];

function randomCodename(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adjective}-${noun}`;
}
