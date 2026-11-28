import { describe, expect, it } from "vitest";
import { diffLines, permissionLabel, withSupervised } from "./approvals";

describe("permissionLabel", () => {
  it("names what the agent wants to do in the operator's words", () => {
    expect(permissionLabel("bash")).toBe("Rodar comando");
    expect(permissionLabel("edit")).toBe("Editar arquivo");
    expect(permissionLabel("lsp")).toBe("Usar lsp");
  });
});

describe("withSupervised", () => {
  it("toggles only the supervised tag and never duplicates it", () => {
    const tags = ["manual", "remote-session"];
    const on = withSupervised(tags, true);
    expect(on).toEqual(["manual", "remote-session", "supervised"]);
    expect(withSupervised(on, true)).toEqual(on);
    expect(withSupervised(on, false)).toEqual(tags);
  });
});

describe("diffLines", () => {
  it("drops the Index header, classifies lines and bounds the preview", () => {
    const diff = "Index: a.txt\n===\n--- a.txt\n+++ a.txt\n@@ -1 +1 @@\n-old\n+new\n same";
    expect(diffLines(diff).map((l) => l.kind)).toEqual([
      "meta",
      "meta",
      "meta",
      "del",
      "add",
      "ctx",
    ]);
    expect(diffLines("+a\n+b\n+c", 2)).toHaveLength(2);
  });
});
