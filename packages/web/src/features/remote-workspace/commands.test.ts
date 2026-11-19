import { describe, expect, it } from "vitest";
import { type Command, filterCommands, formatShortcut, matchShortcut } from "./commands";

const key = (init: Partial<KeyboardEvent>) => ({
  key: "",
  code: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...init,
});

describe("matchShortcut", () => {
  it("maps mod to ⌘ on Apple and Ctrl elsewhere", () => {
    expect(matchShortcut(key({ key: "k", metaKey: true }), "mod+k", true)).toBe(true);
    expect(matchShortcut(key({ key: "k", ctrlKey: true }), "mod+k", true)).toBe(false);
    expect(matchShortcut(key({ key: "K", ctrlKey: true }), "mod+k", false)).toBe(true);
  });

  it("requires the exact modifiers, so mod+k does not fire on mod+shift+k", () => {
    expect(matchShortcut(key({ key: "k", ctrlKey: true, shiftKey: true }), "mod+k", false)).toBe(
      false
    );
  });

  it("matches alt+digit on the physical key, since macOS rewrites the character", () => {
    expect(matchShortcut(key({ key: "¡", code: "Digit1", altKey: true }), "alt+1", true)).toBe(
      true
    );
    expect(matchShortcut(key({ key: "1", code: "Digit1" }), "alt+1", true)).toBe(false);
  });

  it("ignores a stray Ctrl on Apple for plain shortcuts", () => {
    expect(matchShortcut(key({ key: "?", shiftKey: true, ctrlKey: true }), "shift+?", true)).toBe(
      false
    );
  });
});

describe("formatShortcut", () => {
  it("uses platform symbols", () => {
    expect(formatShortcut("mod+shift+o", true)).toBe("⌘⇧O");
    expect(formatShortcut("mod+shift+o", false)).toBe("Ctrl+Shift+O");
  });
});

describe("filterCommands", () => {
  const command = (id: string, title: string, section: Command["section"], keywords = "") => ({
    id,
    title,
    section,
    keywords,
    run: () => {},
  });
  const all = [
    command("s1", "Corrigir login", "Sessões", "fixture"),
    command("nav", "Configurações", "Navegação"),
    command("new", "Nova sessão", "Ações"),
  ];

  it("groups by section when there is no query", () => {
    expect(filterCommands(all, " ").map((c) => c.id)).toEqual(["new", "nav", "s1"]);
  });

  it("ignores accents and case and needs every word", () => {
    expect(filterCommands(all, "configuracoes").map((c) => c.id)).toEqual(["nav"]);
    expect(filterCommands(all, "login fixture").map((c) => c.id)).toEqual(["s1"]);
    expect(filterCommands(all, "login outro")).toEqual([]);
  });

  it("ranks titles that start with the query first", () => {
    const list = [command("a", "Abrir sessão nova", "Ações"), command("b", "Nova sessão", "Ações")];
    expect(filterCommands(list, "nova").map((c) => c.id)).toEqual(["b", "a"]);
  });
});
