import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkLog } from "./WorkLog";

describe("WorkLog", () => {
  it("summarizes the run and marks each call with its state", () => {
    render(
      <WorkLog
        live={false}
        entries={[
          { kind: "read", label: "Leu", detail: "src/a.ts", result: "Read 3 non-empty lines" },
          { kind: "edit", label: "Editou", detail: "src/a.ts", result: "File saved" },
          {
            kind: "command",
            label: "Executou",
            detail: "bun test",
            result: "Command exited with code 1",
            failed: true,
          },
        ]}
      />
    );
    expect(screen.getByText("Falhou em parte")).toBeInTheDocument();
    expect(screen.getByText("1 edição · 1 comando · 1 leitura")).toBeInTheDocument();
    expect(screen.getByText("falhou", { selector: ".rw-sr-only" })).toBeInTheDocument();
    // The result shows in the collapsed row and in full inside the row's body.
    expect(screen.getAllByText("Command exited with code 1")).toHaveLength(2);
  });

  it("announces a live run and the call that is still going", () => {
    render(<WorkLog live entries={[{ kind: "read", label: "Leu", detail: "src/a.ts" }]} />);
    expect(screen.getByText("Trabalhando")).toBeInTheDocument();
    expect(screen.getByText("em andamento", { selector: ".rw-sr-only" })).toBeInTheDocument();
  });

  it("expands a row to show the full command and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <WorkLog
        live={false}
        entries={[
          {
            kind: "command",
            label: "Executou",
            detail: "bun run lint",
            result: "Command completed",
          },
        ]}
      />
    );
    await userEvent.click(screen.getByText("Trabalhou"));
    await userEvent.click(screen.getByText("Executou"));
    expect(screen.getByText("Entrada")).toBeInTheDocument();
    expect(screen.getByText("Resultado")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copiar comando" }));
    expect(writeText).toHaveBeenCalledWith("bun run lint");
    expect(screen.getByRole("button", { name: "Copiado" })).toBeInTheDocument();
  });
});
