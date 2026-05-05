import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalSessionPanel } from "./TerminalSessionPanel";

describe("TerminalSessionPanel", () => {
  it("opens terminal session on mount and sends input", () => {
    const onWsSend = vi.fn();

    render(<TerminalSessionPanel taskId="task-1" runId="run-1" chunks={[]} onWsSend={onWsSend} />);

    expect(onWsSend).toHaveBeenCalledWith({
      type: "terminal_open",
      taskId: "task-1",
      runId: "run-1",
      version: "v2",
    });

    const input = screen.getByPlaceholderText("Digite comando ou resposta...");
    fireEvent.change(input, { target: { value: "echo hello" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(onWsSend).toHaveBeenCalledWith({
      type: "terminal_input",
      taskId: "task-1",
      input: "echo hello\n",
      version: "v2",
    });
  });
});
