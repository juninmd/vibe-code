import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";

function stubClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("CopyButton", () => {
  it("copies the given text and confirms the action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<CopyButton text="resposta do agente" label="Copiar resposta" hideLabel />);
    await userEvent.click(screen.getByRole("button", { name: "Copiar resposta" }));
    expect(writeText).toHaveBeenCalledWith("resposta do agente");
    expect(screen.getByRole("button", { name: "Copiado" })).toBeInTheDocument();
  });

  it("reads deferred text at click time, for code that only exists in the DOM", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<CopyButton text={() => "const a = 1;"} label="Copiar código" />);
    await userEvent.click(screen.getByRole("button", { name: "Copiar código" }));
    expect(writeText).toHaveBeenCalledWith("const a = 1;");
    expect(screen.getByText("Copiado")).toBeInTheDocument();
  });

  it("stays idle when the clipboard is denied", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<CopyButton text="x" label="Copiar mensagem" hideLabel />);
    await userEvent.click(screen.getByRole("button", { name: "Copiar mensagem" }));
    expect(screen.getByRole("button", { name: "Copiar mensagem" })).toBeInTheDocument();
  });
});
