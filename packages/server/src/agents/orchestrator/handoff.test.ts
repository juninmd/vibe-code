import { describe, expect, it } from "bun:test";
import { handoffPreamble, handoffTranscript } from "./handoff";

describe("handoffTranscript", () => {
  it("keeps what was said, not the tool chatter or system lines", () => {
    const text = handoffTranscript([
      { stream: "stdin", content: "Adicione validação de e-mail" },
      { stream: "system", content: "[opencode] serve session ses_1" },
      { stream: "stdout", content: "Vou localizar o formulário." },
      { stream: "stdout", content: "  Reading src/form.ts" },
      { stream: "stdout", content: "    File saved" },
      { stream: "stdout", content: "Pronto, validei no onBlur." },
    ]);
    expect(text).toBe(
      "Usuário: Adicione validação de e-mail\n\nAgente: Vou localizar o formulário.\nPronto, validei no onBlur."
    );
  });

  it("drops the oldest turns first and says so when the conversation is too long", () => {
    const logs = Array.from({ length: 10 }, (_, i) => ({
      stream: i % 2 ? "stdout" : "stdin",
      content: `turno ${i} ${"x".repeat(50)}`,
    }));
    const text = handoffTranscript(logs, 200);
    expect(text.startsWith("[início da conversa omitido]")).toBe(true);
    expect(text).toContain("turno 9");
    expect(text).not.toContain("turno 0");
  });

  it("handles an empty history", () => {
    expect(handoffTranscript([])).toBe("");
    expect(handoffPreamble("", "opencode")).toContain("(no messages yet)");
    expect(handoffPreamble("Usuário: oi")).toContain("rewound");
  });
});
