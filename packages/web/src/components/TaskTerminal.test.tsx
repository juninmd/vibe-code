import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishTerminalEvent } from "../hooks/terminalBus";

// vi.mock factories are hoisted above imports, so the fake lives in vi.hoisted.
const { instances, FakeTerminal } = vi.hoisted(() => {
  const instances: Array<InstanceType<typeof FakeTerminal>> = [];

  class FakeTerminal {
    cols = 100;
    rows = 30;
    writes: string[] = [];
    resetCalls = 0;
    disposed = false;
    private dataHandlers: Array<(data: string) => void> = [];
    constructor() {
      instances.push(this);
    }
    loadAddon() {}
    open() {}
    focus() {}
    write(data: string) {
      this.writes.push(data);
    }
    reset() {
      this.resetCalls++;
    }
    onData(handler: (data: string) => void) {
      this.dataHandlers.push(handler);
      return { dispose: () => {} };
    }
    onResize() {
      return { dispose: () => {} };
    }
    dispose() {
      this.disposed = true;
    }
    type(data: string) {
      for (const handler of this.dataHandlers) handler(data);
    }
  }

  return { instances, FakeTerminal };
});

vi.mock("@xterm/xterm", () => ({ Terminal: FakeTerminal }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

import { TaskTerminal } from "./TaskTerminal";

beforeEach(() => {
  instances.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
});

describe("TaskTerminal", () => {
  it("attaches to the task session when connected, at the visible size", () => {
    const send = vi.fn();
    render(<TaskTerminal taskId="t1" connected onWsSend={send} />);
    expect(send).toHaveBeenCalledWith({ type: "terminal_open", taskId: "t1", cols: 100, rows: 30 });
  });

  it("waits for the socket before attaching", () => {
    const send = vi.fn();
    const { rerender } = render(<TaskTerminal taskId="t1" connected={false} onWsSend={send} />);
    expect(send).not.toHaveBeenCalled();
    rerender(<TaskTerminal taskId="t1" connected onWsSend={send} />);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "terminal_open" }));
  });

  it("forwards raw keystrokes to the PTY", () => {
    const send = vi.fn();
    render(<TaskTerminal taskId="t1" connected onWsSend={send} />);
    instances[0].type("\x1b[A");
    expect(send).toHaveBeenCalledWith({ type: "terminal_input", taskId: "t1", input: "\x1b[A" });
  });

  it("writes output and resets through the write queue, never with reset()", () => {
    render(<TaskTerminal taskId="t1" connected onWsSend={vi.fn()} />);
    const term = instances[0];

    publishTerminalEvent("t1", { kind: "opened", runId: "r", cols: 100, rows: 30 });
    publishTerminalEvent("t1", { kind: "output", chunk: "SNAPSHOT", replay: true });
    publishTerminalEvent("t1", { kind: "output", chunk: "live", replay: false });

    // reset() is synchronous while write() is queued: resetting directly would wipe
    // screens that are still waiting in the queue.
    expect(term.resetCalls).toBe(0);
    expect(term.writes).toEqual(["\x1bc", "\x1bc", "SNAPSHOT", "live"]);
  });

  it("announces the end of the session in the terminal", () => {
    render(<TaskTerminal taskId="t1" connected onWsSend={vi.fn()} />);
    publishTerminalEvent("t1", { kind: "closed", exitCode: 2, reason: "exit" });
    expect(instances[0].writes.join("")).toContain("session ended (exit 2)");
  });

  it("detaches without killing the session on unmount", () => {
    const send = vi.fn();
    const { unmount } = render(<TaskTerminal taskId="t1" connected onWsSend={send} />);
    unmount();
    expect(send).toHaveBeenCalledWith({ type: "terminal_close", taskId: "t1" });
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "terminal_signal" }));
    expect(instances[0].disposed).toBe(true);
  });

  it("reports when real output shows up", () => {
    const onActivity = vi.fn();
    render(<TaskTerminal taskId="t1" connected onWsSend={vi.fn()} onActivity={onActivity} />);
    publishTerminalEvent("t1", { kind: "output", chunk: "   ", replay: false });
    expect(onActivity).not.toHaveBeenCalled();
    publishTerminalEvent("t1", { kind: "output", chunk: "hello", replay: false });
    expect(onActivity).toHaveBeenCalledWith(true);
  });
});
