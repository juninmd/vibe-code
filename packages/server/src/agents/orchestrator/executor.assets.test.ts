import { describe, expect, test } from "bun:test";
import {
  normalizeRepoWebUrl,
  extractDocsAssetPath,
  buildAssetBlobUrl,
  rewriteDocsAssetLinks,
} from "./executor";

describe("executor - asset utilities", () => {
  describe("normalizeRepoWebUrl", () => {
    test("removes .git and trailing slash", () => {
      expect(normalizeRepoWebUrl("https://github.com/user/repo.git")).toBe("https://github.com/user/repo");
      expect(normalizeRepoWebUrl("https://github.com/user/repo/")).toBe("https://github.com/user/repo");
    });

    test("handles non-url strings safely", () => {
       expect(normalizeRepoWebUrl("git@github.com:user/repo.git")).toBe("https://github.com/user/repo");
       expect(normalizeRepoWebUrl("git@gitlab.com:user/repo")).toBe("https://gitlab.com/user/repo");
       expect(normalizeRepoWebUrl("not a url")).toBe("not a url");
    });
  });

  describe("extractDocsAssetPath", () => {
    test("extracts docs/assets/ path correctly", () => {
      expect(extractDocsAssetPath("./docs/assets/image.png")).toBe("docs/assets/image.png");
      expect(extractDocsAssetPath("docs/assets/image.png?raw=true")).toBe("docs/assets/image.png");
      expect(extractDocsAssetPath("/some/path/docs/assets/image.png")).toBe("docs/assets/image.png");
    });

    test("returns null if not found", () => {
      expect(extractDocsAssetPath("some/other/image.png")).toBeNull();
    });
  });

  describe("buildAssetBlobUrl", () => {
    test("builds github url", () => {
      expect(buildAssetBlobUrl("https://github.com/user/repo", "main/branch", "docs/assets/img.png")).toBe("https://github.com/user/repo/blob/main/branch/docs/assets/img.png");
    });

    test("builds gitlab url", () => {
      expect(buildAssetBlobUrl("https://gitlab.com/user/repo", "main/branch", "docs/assets/img.png")).toBe("https://gitlab.com/user/repo/-/blob/main/branch/docs/assets/img.png?ref_type=heads");
    });

    test("builds fallback url", () => {
      expect(buildAssetBlobUrl("https://bitbucket.org/user/repo", "main/branch", "docs/assets/img.png")).toBe("https://bitbucket.org/user/repo/-/blob/main/branch/docs/assets/img.png");
    });
  });

  describe("rewriteDocsAssetLinks", () => {
    test("rewrites asset links correctly", () => {
      const input = "Here is an image ![Alt text](./docs/assets/img.png) and another ![Other](other.png)";
      const output = rewriteDocsAssetLinks(input, "https://github.com/user/repo", "main");
      expect(output).toContain("![Alt text](https://github.com/user/repo/blob/main/docs/assets/img.png)");
      expect(output).toContain("![Other](other.png)");
    });
  });
});
