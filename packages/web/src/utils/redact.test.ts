import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it("redacts GitHub PAT in free text", () => {
    expect(redactSecrets("see commit ghp_" + "a".repeat(40))).toContain("[REDACTED GITHUB TOKEN]");
  });
  it("redacts OpenAI/Anthropic style sk- keys", () => {
    expect(redactSecrets("sk-" + "x".repeat(40))).toContain("[REDACTED API KEY]");
  });
  it("redacts AWS access key id", () => {
    expect(redactSecrets("AKIA" + "A".repeat(16))).toContain("[REDACTED AWS KEY]");
  });
  it("redacts JWT", () => {
    const jwt = "ey" + "a".repeat(15) + "." + "b".repeat(15) + "." + "c".repeat(15);
    expect(redactSecrets(jwt)).toContain("[REDACTED JWT]");
  });
  it("redacts Bearer auth", () => {
    expect(redactSecrets("Authorization: Bearer abc123==")).toContain("Bearer [REDACTED]");
  });
  it("redacts connection strings with embedded password", () => {
    expect(redactSecrets("postgres://user:secret@host/db")).toContain(
      "[REDACTED CONNECTION STRING]"
    );
  });
  it("redacts API_KEY=value env vars", () => {
    expect(redactSecrets("API_KEY=abc123")).toContain("[REDACTED CREDENTIAL]");
  });
  it("passes through innocuous text unchanged", () => {
    const safe = "Reading file src/main.ts (3 lines)";
    expect(redactSecrets(safe)).toBe(safe);
  });
  it("handles empty input", () => {
    expect(redactSecrets("")).toBe("");
  });
});
