import { describe, expect, it } from "vitest";
import { caretAtEdge, pruneDrafts, recordPrompt, stepHistory } from "./composerHistory";

describe("recordPrompt", () => {
  it("keeps newest first, trims and drops duplicates and blanks", () => {
    expect(recordPrompt(["b", "a"], "  a ")).toEqual(["a", "b"]);
    expect(recordPrompt(["a"], "   ")).toEqual(["a"]);
  });

  it("is bounded", () => {
    expect(recordPrompt(["c", "b", "a"], "d", 3)).toEqual(["d", "c", "b"]);
  });
});

describe("stepHistory", () => {
  const history = ["newest", "older"];

  it("walks back through prompts and returns to the unsent draft", () => {
    const first = stepHistory(history, -1, "older", "rascunho");
    expect(first).toEqual({ position: 0, text: "newest" });
    const second = stepHistory(history, 0, "older", "rascunho");
    expect(second).toEqual({ position: 1, text: "older" });
    expect(stepHistory(history, 1, "older", "rascunho")).toBeNull();
    expect(stepHistory(history, 0, "newer", "rascunho")).toEqual({
      position: -1,
      text: "rascunho",
    });
    expect(stepHistory(history, -1, "newer", "rascunho")).toBeNull();
  });

  it("does nothing with an empty history", () => {
    expect(stepHistory([], -1, "older", "")).toBeNull();
  });
});

describe("caretAtEdge", () => {
  it("leaves arrow keys to multi-line editing away from the edges", () => {
    const text = "linha 1\nlinha 2";
    expect(caretAtEdge(text, 3, 3, "older")).toBe(true);
    expect(caretAtEdge(text, 10, 10, "older")).toBe(false);
    expect(caretAtEdge(text, 10, 10, "newer")).toBe(true);
    expect(caretAtEdge(text, 3, 3, "newer")).toBe(false);
  });

  it("does not recall over a selection", () => {
    expect(caretAtEdge("abc", 0, 2, "older")).toBe(false);
  });
});

describe("pruneDrafts", () => {
  it("drops empty drafts and keeps only the most recent ones", () => {
    expect(pruneDrafts({ a: "1", b: " ", c: "3", d: "4" }, 2)).toEqual({ c: "3", d: "4" });
  });
});
