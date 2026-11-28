import { describe, expect, test } from "bun:test";
import { deriveSessionTitle, sessionNamePrefix, slugifySessionText } from "./session-name";

describe("slugifySessionText", () => {
  test("reduces a sentence to a dash slug", () => {
    expect(slugifySessionText("Fix the login bug")).toBe("fix-the-login-bug");
  });

  test("skips leading code fences and markdown markers", () => {
    const text = "```ts\n# Add retry to fetch\n```";
    expect(slugifySessionText(text)).toBe("add-retry-to-fetch");
  });

  test("takes only the first meaningful line", () => {
    expect(slugifySessionText("First line\nsecond line")).toBe("first-line");
  });

  test("caps the number of words", () => {
    const slug = slugifySessionText("one two three four five six seven eight nine");
    expect(slug.split("-")).toHaveLength(6);
  });

  test("strips punctuation and collapses dashes", () => {
    expect(slugifySessionText("Fix: a/b+c (urgent!!)")).toBe("fix-a-b-c-urgent");
  });

  test("returns empty for blank input", () => {
    expect(slugifySessionText("   \n\n")).toBe("");
    expect(slugifySessionText("```")).toBe("");
  });

  test("caps the slug length", () => {
    const slug = slugifySessionText("a".repeat(120));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("sessionNamePrefix", () => {
  test("prefers the configured env prefix", () => {
    const previous = process.env.VIBE_CODE_SESSION_NAME_PREFIX;
    process.env.VIBE_CODE_SESSION_NAME_PREFIX = "My Box";
    try {
      expect(sessionNamePrefix()).toBe("my-box");
    } finally {
      if (previous === undefined) delete process.env.VIBE_CODE_SESSION_NAME_PREFIX;
      else process.env.VIBE_CODE_SESSION_NAME_PREFIX = previous;
    }
  });
});

describe("deriveSessionTitle", () => {
  test("prefixes the derived slug", () => {
    const previous = process.env.VIBE_CODE_SESSION_NAME_PREFIX;
    process.env.VIBE_CODE_SESSION_NAME_PREFIX = "harness";
    try {
      expect(deriveSessionTitle("Ship the mobile board")).toBe("harness-ship-the-mobile-board");
    } finally {
      if (previous === undefined) delete process.env.VIBE_CODE_SESSION_NAME_PREFIX;
      else process.env.VIBE_CODE_SESSION_NAME_PREFIX = previous;
    }
  });

  test("falls back to a codename when the prompt is empty", () => {
    const title = deriveSessionTitle("   ");
    expect(title).toMatch(/^[a-z0-9-]+$/);
    expect(title.split("-").length).toBeGreaterThanOrEqual(2);
  });
});
