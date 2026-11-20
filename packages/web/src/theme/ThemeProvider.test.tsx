import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "./ThemeProvider";

function systemPrefers(light: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: light && query.includes("light"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeProvider", () => {
  it("follows a light system setting until the user picks a theme", () => {
    systemPrefers(true);
    render(<ThemeProvider>x</ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("keeps the user's own choice over the system", () => {
    systemPrefers(true);
    localStorage.setItem("vibe-code-theme", "dark");
    render(<ThemeProvider>x</ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows the system live when it changes, until the user picks a theme", () => {
    const listeners: (() => void)[] = [];
    const query = {
      matches: false,
      media: "(prefers-color-scheme: light)",
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", () => query);
    const { unmount } = render(<ThemeProvider>x</ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe("dark");
    query.matches = true;
    act(() => {
      for (const fn of listeners) fn();
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    unmount();
    expect(query.removeEventListener).toHaveBeenCalled();
  });

  it("stays dark when the system is dark", () => {
    systemPrefers(false);
    render(<ThemeProvider>x</ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
