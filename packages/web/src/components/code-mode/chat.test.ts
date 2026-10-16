import type { AgentLog } from "@vibe-code/shared";
import { describe, expect, it } from "vitest";
import { buildChatItems, sessionLabel, stripAnsi } from "./chat";

const ESC = String.fromCharCode(27);

function log(partial: Partial<AgentLog> & { content: string }): AgentLog {
  return {
    id: 0,
    runId: "run-1",
    stream: "stdout",
    timestamp: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const task = {
  id: "t-1",
  title: "harness-fix-login",
  description: "Fix the login bug",
  goal: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("stripAnsi", () => {
  it("removes color escapes", () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m`)).toBe("red");
  });
});

describe("buildChatItems", () => {
  it("starts with the prompt bubble", () => {
    const items = buildChatItems(task, []);
    expect(items[0]).toMatchObject({ kind: "prompt", text: "Fix the login bug" });
  });

  it("merges consecutive stdout lines into one assistant bubble", () => {
    const items = buildChatItems(task, [
      log({ content: "Reading files", id: 1 }),
      log({ content: "Editing src/auth.ts", id: 2 }),
    ]);
    const assistant = items.filter((item) => item.kind === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toMatchObject({ text: "Reading files\nEditing src/auth.ts" });
  });

  it("splits assistant output around stderr", () => {
    const items = buildChatItems(task, [
      log({ content: "step 1", id: 1 }),
      log({ content: "boom", stream: "stderr", id: 2 }),
      log({ content: "step 2", id: 3 }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["prompt", "assistant", "error", "assistant"]);
  });

  it("keeps system notices discrete", () => {
    const items = buildChatItems(task, [
      log({ content: "phase:validating", stream: "system", id: 1 }),
      log({ content: "phase:reviewing", stream: "system", id: 2 }),
    ]);
    expect(items.filter((item) => item.kind === "system")).toHaveLength(2);
  });

  it("orders items by timestamp", () => {
    const items = buildChatItems(task, [
      log({ content: "second", stream: "system", id: 1, timestamp: "2026-01-01T00:00:05.000Z" }),
      log({ content: "first", stream: "system", id: 2, timestamp: "2026-01-01T00:00:01.000Z" }),
    ]);
    expect(items[1]).toMatchObject({ kind: "system", text: "first" });
    expect(items[2]).toMatchObject({ kind: "system", text: "second" });
  });

  it("drops blank log lines", () => {
    const items = buildChatItems(task, [log({ content: "   ", id: 1 })]);
    expect(items).toHaveLength(1); // prompt only
  });

  it("omits the prompt when the task has no description or goal", () => {
    const items = buildChatItems({ ...task, description: "", goal: null }, [
      log({ content: "hello", id: 1 }),
    ]);
    expect(items[0]).toMatchObject({ kind: "assistant" });
  });
});

describe("sessionLabel", () => {
  it("prefers the title", () => {
    expect(sessionLabel(task)).toBe("harness-fix-login");
  });

  it("falls back to the first description line", () => {
    expect(sessionLabel({ title: "  ", description: "Add pagination\nmore" })).toBe(
      "Add pagination"
    );
  });

  it("falls back to a placeholder", () => {
    expect(sessionLabel({ title: "", description: "" })).toBe("Untitled session");
  });
});
