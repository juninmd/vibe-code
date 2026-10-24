import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as os from "node:os";
import { deriveSessionTitle, sessionNamePrefix, slugifySessionText } from "../session-name";

describe("session-name utils", () => {
  afterEach(() => {
    delete process.env.VIBE_CODE_SESSION_NAME_PREFIX;
    mock.restore();
  });

  describe("slugifySessionText", () => {
    it("should return empty string for empty input", () => {
      expect(slugifySessionText("")).toBe("");
      expect(slugifySessionText("   ")).toBe("");
    });

    it("should extract meaningful text ignoring markdown formatting", () => {
      expect(slugifySessionText("### Hello World")).toBe("hello-world");
      expect(slugifySessionText("> Quote text")).toBe("quote-text");
      expect(slugifySessionText("* List item")).toBe("list-item");
      expect(slugifySessionText("`inline code`")).toBe("inline-code");
      expect(slugifySessionText("**Bold text**")).toBe("bold-text");
    });

    it("should limit the number of words", () => {
      expect(slugifySessionText("one two three four five six seven eight")).toBe(
        "one-two-three-four-five-six"
      );
    });

    it("should enforce maximum length", () => {
      const veryLongWord = "a".repeat(100);
      const result = slugifySessionText(veryLongWord);
      expect(result.length).toBeLessThanOrEqual(48);
      expect(result).toBe("a".repeat(48));
    });

    it("should skip code fences", () => {
      const text = "```typescript\nconst a = 1;\n```\nUseful text";
      // It skips lines starting with ```, but returns the first non-empty one that doesn't start with ```
      expect(slugifySessionText(text)).toBe("const-a-1");
    });
  });

  describe("sessionNamePrefix", () => {
    it("should use VIBE_CODE_SESSION_NAME_PREFIX if set", () => {
      process.env.VIBE_CODE_SESSION_NAME_PREFIX = "my custom prefix";
      expect(sessionNamePrefix()).toBe("my-custom-prefix");
    });

    it("should use raw VIBE_CODE_SESSION_NAME_PREFIX if it can't be slugified", () => {
      process.env.VIBE_CODE_SESSION_NAME_PREFIX = "!!!";
      expect(sessionNamePrefix()).toBe("!!!");
    });

    it("should fallback to slugified hostname", () => {
      spyOn(os, "hostname").mockReturnValue("Test-Host-Name");
      expect(sessionNamePrefix()).toBe("test-host-name");
    });

    it("should fallback to 'harness' if hostname is invalid", () => {
      spyOn(os, "hostname").mockReturnValue("!!!");
      expect(sessionNamePrefix()).toBe("harness");
    });
  });

  describe("deriveSessionTitle", () => {
    it("should combine prefix and slugified description", () => {
      spyOn(os, "hostname").mockReturnValue("testhost");
      expect(deriveSessionTitle("Fix the bug")).toBe("testhost-fix-the-bug");
    });

    it("should use random codename if description is empty", () => {
      spyOn(os, "hostname").mockReturnValue("testhost");
      const title = deriveSessionTitle("");
      expect(title.startsWith("testhost-")).toBe(true);
      expect(title.split("-").length).toBe(3); // testhost-adjective-noun
    });

    it("should enforce length limit on final title", () => {
      process.env.VIBE_CODE_SESSION_NAME_PREFIX = "a".repeat(50);
      const description = "b".repeat(50);
      const result = deriveSessionTitle(description);
      expect(result.length).toBeLessThanOrEqual(80);
      expect(result.endsWith("-")).toBe(false);
    });
  });
});
