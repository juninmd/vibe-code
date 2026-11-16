import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ServerSetup from "./ServerSetup";

describe("ServerSetup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("accepts the scheme-less host:port the screen suggests", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    // jsdom cannot reload; the stored URL is what the next launch reads.
    vi.stubGlobal("location", { ...window.location, reload: vi.fn() });
    render(<ServerSetup />);

    const input = screen.getByLabelText("Endereço do servidor") as HTMLInputElement;
    await userEvent.type(input, "192.168.0.10:3000");
    // A type="url" field refuses this value before the form is ever submitted.
    expect(input.checkValidity()).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Conectar" }));

    expect(fetchMock).toHaveBeenCalledWith("http://192.168.0.10:3000/health", expect.anything());
    expect(localStorage.getItem("harness-remote-server-url")).toBe("http://192.168.0.10:3000");
  });

  it("explains an unreachable server and stores nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    render(<ServerSetup />);

    await userEvent.type(screen.getByLabelText("Endereço do servidor"), "10.0.0.9:3000");
    await userEvent.click(screen.getByRole("button", { name: "Conectar" }));

    expect(await screen.findByText(/Não foi possível conectar/)).toBeInTheDocument();
    expect(localStorage.getItem("harness-remote-server-url")).toBeNull();
  });
});
