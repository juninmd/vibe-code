import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import type { Command } from "./commands";

// jsdom does not implement the native dialog methods Sonido calls.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

const commands: Command[] = [
  {
    id: "new",
    section: "Ações",
    title: "Nova sessão",
    shortcut: "mod+shift+o",
    run: vi.fn(),
  },
  {
    id: "theme",
    section: "Ações",
    title: "Usar tema claro",
    keywords: "aparência",
    run: vi.fn(),
  },
];

describe("CommandPalette", () => {
  it("lists the app's commands and groups in Sonido's palette", () => {
    render(<CommandPalette commands={commands} onClose={vi.fn()} />);
    expect(screen.getByRole("option", { name: /Nova sessão/ })).toBeInTheDocument();
    expect(screen.getByText("Ações")).toBeInTheDocument();
  });

  it("keeps the app's accent-insensitive search", async () => {
    render(<CommandPalette commands={commands} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "aparencia");
    expect(screen.getByRole("option", { name: /Usar tema claro/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Nova sessão/ })).not.toBeInTheDocument();
  });

  it("runs the active command and closes the palette with Enter", async () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette commands={[{ ...commands[0], run }]} onClose={onClose} />);
    await userEvent.type(screen.getByRole("combobox"), "nova{Enter}");
    expect(onClose).toHaveBeenCalled();
    expect(run).toHaveBeenCalled();
  });
});
