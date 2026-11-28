import { describe, expect, it } from "vitest";
import { sonidoTheme } from "./sonido";

describe("Sonido theme bridge", () => {
  it("keeps the themes both layers publish", () => {
    expect(sonidoTheme("dark")).toBe("dark");
    expect(sonidoTheme("light")).toBe("light");
    expect(sonidoTheme("dracula")).toBe("dracula");
  });

  it("paints Sonido's default dark tokens for the GitHub palette it does not publish", () => {
    expect(sonidoTheme("github-dark")).toBe("dark");
  });

  it("falls back to dark instead of leaving Sonido unstyled", () => {
    expect(sonidoTheme("unknown")).toBe("dark");
  });
});
