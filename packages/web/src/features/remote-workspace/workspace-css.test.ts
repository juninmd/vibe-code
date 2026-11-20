import { describe, expect, it } from "vitest";
import css from "./workspace.css?raw";

describe("workspace.css readability guards", () => {
  it("never sets text below 10px, which is unreadable on phones and at 200% zoom", () => {
    const tiny = [...css.matchAll(/font(?:-size)?:[^;}]*?\b(\d+(?:\.\d+)?)px/g)]
      .map((m) => Number(m[1]))
      .filter((px) => px < 10);
    expect(tiny).toEqual([]);
  });

  it("keeps form fields at 16px on phones so iOS does not zoom the layout on focus", () => {
    expect(css).toMatch(
      /@media \(max-width: 767px\), \(pointer: coarse\) \{\s*\.rw-root :is\(input, select, textarea\)[^{]*\{ font-size: 16px; \}/
    );
  });
});
