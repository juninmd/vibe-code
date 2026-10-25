import { describe, expect, it } from "vitest";
import { isNativeApp, normalizeServerUrl } from "./server-url";

describe("server-url", () => {
  it("normalizes user input", () => {
    expect(normalizeServerUrl(" 192.168.0.10:3000/ ")).toBe("http://192.168.0.10:3000");
    expect(normalizeServerUrl("https://x.dev//")).toBe("https://x.dev");
    expect(normalizeServerUrl("  ")).toBe("");
  });

  it("is not native in the browser", () => {
    expect(isNativeApp()).toBe(false);
  });
});
