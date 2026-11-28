import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { logAgentEvent } from "./terminal-logger";

describe("terminal-logger", () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it("scrubs credentials before writing agent output to the server console", () => {
    const written: string[] = [];
    const spy = spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    restore = () => spy.mockRestore();

    logAgentEvent("task-1234", "stdout", "token gho_abcdefghijklmnopqrstuvwxyz0123 here");
    spy.mockRestore();
    restore = undefined;

    const out = written.join("");
    expect(out).not.toContain("gho_abcdefghijklmnopqrstuvwxyz0123");
    expect(out).toContain("[REDACTED]");
  });
});
