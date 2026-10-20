import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CodeComposer } from "./CodeComposer";

describe("CodeComposer", () => {
  it("preserves the draft and shows an error when delivery fails", async () => {
    render(
      <CodeComposer
        placeholder="Message"
        onSubmit={async () => {
          throw new Error("Server unavailable");
        }}
      />
    );
    await userEvent.type(screen.getByPlaceholderText("Message"), "Keep my work{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Server unavailable");
    expect(screen.getByPlaceholderText("Message")).toHaveValue("Keep my work");
  });
  it("submits on Enter and clears the field", async () => {
    const onSubmit = vi.fn();
    render(<CodeComposer placeholder="Describe a task…" onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText("Describe a task…");
    await userEvent.type(input, "Fix the build{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Fix the build");
    expect(input).toHaveValue("");
  });

  it("inserts a newline on Shift+Enter without submitting", async () => {
    const onSubmit = vi.fn();
    render(<CodeComposer placeholder="Describe a task…" onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText("Describe a task…");
    await userEvent.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one\nline two");
  });

  it("does not submit whitespace only", async () => {
    const onSubmit = vi.fn();
    render(<CodeComposer placeholder="Describe a task…" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByPlaceholderText("Describe a task…"), "   {Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("respects the disabled state", async () => {
    const onSubmit = vi.fn();
    render(<CodeComposer placeholder="Describe a task…" onSubmit={onSubmit} disabled />);
    const input = screen.getByPlaceholderText("Describe a task…");
    expect(input).toBeDisabled();
  });
});
