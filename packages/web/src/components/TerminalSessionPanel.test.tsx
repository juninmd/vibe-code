// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalSessionPanel } from "./TerminalSessionPanel";

describe("TerminalSessionPanel", () => {
  it("opens terminal session on mount and sends input", async () => {
    const onWsSend = vi.fn();

    await act(async () => {
      render(
        <TerminalSessionPanel taskId="task-1" runId="run-1" chunks={[]} onWsSend={onWsSend} />
      );
    });

    expect(onWsSend).toHaveBeenCalledWith({
      type: "terminal_open",
      taskId: "task-1",
      runId: "run-1",
      version: "v2",
    });

    const input = screen.getByPlaceholderText("Digite comando ou resposta...");
    await act(async () => {
      fireEvent.change(input, { target: { value: "echo hello" } });
    });

    await act(async () => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    });

    expect(onWsSend).toHaveBeenCalledWith({
      type: "terminal_input",
      taskId: "task-1",
      input: "echo hello\n",
      version: "v2",
    });
  });
});
