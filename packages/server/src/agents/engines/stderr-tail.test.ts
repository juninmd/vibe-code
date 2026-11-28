import { describe, expect, it } from "bun:test";
import { StderrTail, withAgentStderr } from "./stderr-tail";

describe("StderrTail", () => {
  it("forwards every chunk and trims tail", () => {
    const seen: string[] = [];
    const t = new StderrTail((c) => seen.push(c), 100);
    t.write("hello ");
    t.write("world\n");
    expect(seen).toEqual(["hello ", "world\n"]);
    expect(t.tail()).toBe("hello world");
  });

  it("bounds buffer to maxBytes from the end", () => {
    const t = new StderrTail(() => {}, 10);
    t.write("0123456789ABCDEFG");
    expect(t.tail().length).toBe(10);
    expect(t.tail()).toBe("789ABCDEFG".trim());
  });

  it("returns empty tail when nothing written", () => {
    expect(new StderrTail(() => {}).tail()).toBe("");
  });
});

describe("withAgentStderr", () => {
  it("appends labeled stderr when non-empty", () => {
    expect(withAgentStderr("exit 1", "codex", "abort: no creds")).toBe(
      "exit 1; codex stderr: abort: no creds"
    );
  });
  it("passes msg through when tail empty", () => {
    expect(withAgentStderr("exit 1", "codex", "")).toBe("exit 1");
  });
});
