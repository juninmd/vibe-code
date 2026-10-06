import { describe, expect, it, vi } from "vitest";
import { publishTerminalEvent, subscribeTerminal } from "./terminalBus";

describe("terminalBus", () => {
  it("delivers events only to subscribers of that task", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeTerminal("task-a", a);
    const offB = subscribeTerminal("task-b", b);

    publishTerminalEvent("task-a", { kind: "output", chunk: "hi", replay: false });

    expect(a).toHaveBeenCalledWith({ kind: "output", chunk: "hi", replay: false });
    expect(b).not.toHaveBeenCalled();
    offA();
    offB();
  });

  it("stops delivering after unsubscribe and tolerates unknown tasks", () => {
    const listener = vi.fn();
    const off = subscribeTerminal("task-c", listener);
    off();
    publishTerminalEvent("task-c", { kind: "closed", exitCode: 0, reason: "exit" });
    publishTerminalEvent("nobody", { kind: "closed", exitCode: 0, reason: "exit" });
    expect(listener).not.toHaveBeenCalled();
  });
});
