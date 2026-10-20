import { describe, expect, it } from "bun:test";
import { EngineRegistry } from "./registry";

describe("EngineRegistry session resume capability", () => {
  const registry = new EngineRegistry();

  it("reports engines that honor resumeSessionId and report the session id", () => {
    expect(registry.isResumable("opencode")).toBe(true);
    expect(registry.isResumable("acpx")).toBe(true);
  });

  it("does not claim resume support for engines that ignore it or never report a session", () => {
    // claude-code runs `claude acp -p` and never reads the resume option.
    expect(registry.isResumable("claude-code")).toBe(false);
    // These pass --session/--resume but emit no session id, so nothing to resume.
    expect(registry.isResumable("codex")).toBe(false);
    expect(registry.isResumable("gemini")).toBe(false);
    expect(registry.isResumable("missing-engine")).toBe(false);
  });
});
