import { describe, expect, it } from "vitest";
import { themes } from "./themes";

type RGB = [number, number, number];

const hex = (value: string): RGB => {
  const n = value.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16)) as RGB;
};

/** Parse "#rrggbb" or "rgba(r, g, b, a)", flattening translucent colours onto `under`. */
function parse(color: string, under: RGB): RGB {
  if (color.startsWith("#")) return hex(color);
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) throw new Error(`Unsupported colour: ${color}`);
  const parts = match[1].split(",").map((part) => Number.parseFloat(part));
  const alpha = parts[3] ?? 1;
  return [0, 1, 2].map((i) => Math.round(parts[i] * alpha + under[i] * (1 - alpha))) as RGB;
}

function luminance([r, g, b]: RGB): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_TOKENS = ["textPrimary", "textSecondary", "textMuted", "textDimmed"] as const;

describe.each(Object.entries(themes))("theme %s", (_name, theme) => {
  const c = theme.colors;
  const app = hex(c.bgApp);
  const backgrounds = [app, parse(c.bgSurface, app), parse(c.bgCard, app)];
  const worst = (token: (typeof TEXT_TOKENS)[number]) =>
    Math.min(...backgrounds.map((bg) => contrast(parse(c[token], app), bg)));

  it.each(TEXT_TOKENS)("%s meets WCAG AA (4.5:1) on every surface", (token) => {
    expect(worst(token)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a visible hierarchy: primary > secondary > muted > dimmed", () => {
    const ratios = TEXT_TOKENS.map(worst);
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeLessThanOrEqual(ratios[i - 1]);
    // ...but not so flat that muted and dimmed are the same grey.
    expect(ratios[2] - ratios[3]).toBeGreaterThan(0.3);
  });
});
