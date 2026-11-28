import { describe, expect, it } from "vitest";
import { splitWork, summarizeWork } from "./workEntries";

describe("splitWork", () => {
  it("keeps tool chatter out of the prose the user reads", () => {
    const text = [
      "Vou localizar o formulário.",
      '  Searching "signup"',
      "    Found 4 matches",
      "  Editing src/Signup.tsx",
      "  Editing src/Signup.tsx",
      "    File saved",
      "Pronto. O campo valida o **e-mail**.",
    ].join("\n");
    const segments = splitWork(text);
    expect(segments.map((s) => s.type)).toEqual(["text", "work", "text"]);
    expect(segments[0]).toEqual({ type: "text", text: "Vou localizar o formulário." });
    expect(segments[2]).toEqual({ type: "text", text: "Pronto. O campo valida o **e-mail**." });
    const work = segments[1].type === "work" ? segments[1].entries : [];
    // The repeated completion label collapses into one entry with its result.
    expect(work).toEqual([
      {
        kind: "search",
        label: "Buscou",
        detail: "signup",
        result: "Found 4 matches",
        failed: false,
      },
      {
        kind: "edit",
        label: "Editou",
        detail: "src/Signup.tsx",
        result: "File saved",
        failed: false,
      },
    ]);
  });

  it("recognizes a tool line that lost its indent at the start of a bubble", () => {
    const segments = splitWork("Writing file\n    File saved");
    expect(segments).toEqual([
      {
        type: "work",
        entries: [{ kind: "edit", label: "Escreveu", result: "File saved", failed: false }],
      },
    ]);
  });

  it("flags a command that exited non-zero", () => {
    const [segment] = splitWork("  Running: bun test\n  Command exited with code 1");
    expect(segment.type === "work" && segment.entries[0]).toMatchObject({
      kind: "command",
      detail: "bun test",
      failed: true,
    });
  });

  it("leaves markdown lists and plain prose untouched", () => {
    const text = "Resumo:\n\n- item\n  - Nested: value\nRunning tests is up to you.";
    expect(splitWork(text)).toEqual([{ type: "text", text }]);
  });

  it("returns nothing for blank input", () => {
    expect(splitWork("  \n ")).toEqual([]);
  });
});

describe("summarizeWork", () => {
  it("counts entries by kind with Portuguese plurals", () => {
    expect(
      summarizeWork([
        { kind: "edit", label: "Editou" },
        { kind: "edit", label: "Escreveu" },
        { kind: "command", label: "Executou" },
      ])
    ).toBe("2 edições · 1 comando");
  });
});

describe("splitWork prose guard", () => {
  it("does not treat unindented prose that starts with a verb as a tool call", () => {
    const text = "Feito.\nReading the docs, the API needs a token.";
    expect(splitWork(text)).toEqual([{ type: "text", text }]);
  });
});

describe("messagesFromLogs", () => {
  it("renders tool calls as a work log between the agent's replies", async () => {
    const { messagesFromLogs } = await import("./model");
    const log = (content: string, i: number) => ({
      id: i,
      runId: "r",
      stream: "stdout" as const,
      content,
      timestamp: new Date(1_000 + i).toISOString(),
    });
    const messages = messagesFromLogs(
      {
        id: "s",
        projectId: "p",
        title: "t",
        description: "Faça X",
        status: "waiting",
        engine: "opencode",
        model: "m",
        branch: "b",
        updatedAt: new Date(0).toISOString(),
        messages: [],
        changes: [],
      },
      ["Vou começar.", "  Reading a.ts", "    Read 3 non-empty lines", "Feito."].map(log)
    );
    expect(messages.map((m) => [m.role, m.text, m.work?.length ?? 0])).toEqual([
      ["user", "Faça X", 0],
      ["assistant", "Vou começar.", 0],
      ["assistant", "", 1],
      ["assistant", "Feito.", 0],
    ]);
  });
});

describe("engine handoff", () => {
  it("credits each reply to the engine that wrote it and marks the takeover", async () => {
    const { messagesFromLogs } = await import("./model");
    const log = (stream: "stdout" | "stdin" | "system", content: string, i: number) => ({
      id: i,
      runId: `r${i}`,
      stream,
      content,
      timestamp: new Date(1_000 + i).toISOString(),
    });
    const messages = messagesFromLogs(
      {
        id: "s",
        projectId: "p",
        title: "t",
        description: "Crie X",
        status: "waiting",
        engine: "grok",
        model: "m",
        branch: "b",
        updatedAt: new Date(0).toISOString(),
        messages: [],
        changes: [],
      },
      [
        log("stdout", "Criei X.", 1),
        log("stdin", "Agora teste", 2),
        log("system", "[handoff] opencode → grok: new session with the conversation so far", 3),
        log("stdout", "Teste criado.", 4),
      ]
    );
    expect(messages.map((m) => [m.role, m.text, m.engine, m.handoff?.to])).toEqual([
      ["user", "Crie X", undefined, undefined],
      ["assistant", "Criei X.", "opencode", undefined],
      ["user", "Agora teste", undefined, undefined],
      ["assistant", "", undefined, "grok"],
      ["assistant", "Teste criado.", "grok", undefined],
    ]);
    // A follow-up knows its turn, so the conversation can rewind to it.
    expect(messages.filter((m) => m.role === "user").map((m) => m.runId)).toEqual([
      undefined,
      "r2",
    ]);
  });
});

describe("refused calls", () => {
  it("stay in the work log, marked as failed", () => {
    const work = splitWork("  Writing src/email.ts\n    Recusado por você").find(
      (s) => s.type === "work"
    );
    expect(work).toMatchObject({
      entries: [{ detail: "src/email.ts", result: "Recusado por você", failed: true }],
    });
  });
});
