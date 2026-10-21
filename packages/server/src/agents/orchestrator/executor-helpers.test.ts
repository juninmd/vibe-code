import { describe, expect, it } from "bun:test";
import {
    extractDocsAssetPath,
    buildAssetBlobUrl,
    normalizeRepoWebUrl,
    docsRelativePath,
    taskSlug
} from "./executor";

describe("executor helper functions coverage", () => {
    describe("normalizeRepoWebUrl", () => {
        it("returns original URL on error", () => {
            expect(normalizeRepoWebUrl("invalid://url:port:bad")).toBe("invalid://url:port:bad");
        });

        it("normalizes github ssh urls", () => {
            expect(normalizeRepoWebUrl("git@github.com:owner/repo.git")).toBe("https://github.com/owner/repo");
        });
    });

    describe("extractDocsAssetPath", () => {
        it("extracts clean docs/assets path", () => {
            expect(extractDocsAssetPath("./docs/assets/image.png?v=1")).toBe("docs/assets/image.png");
        });

        it("finds docs/assets nested in path", () => {
            expect(extractDocsAssetPath("/var/tmp/project/docs/assets/pic.jpg#hash")).toBe("docs/assets/pic.jpg");
        });

        it("returns null when not found", () => {
            expect(extractDocsAssetPath("src/components/button.tsx")).toBeNull();
        });
    });

    describe("buildAssetBlobUrl", () => {
        it("builds github blob url", () => {
            const url = buildAssetBlobUrl("https://github.com/owner/repo", "feat/my-branch", "docs/assets/img.png");
            expect(url).toBe("https://github.com/owner/repo/blob/feat/my-branch/docs/assets/img.png");
        });

        it("builds gitlab blob url", () => {
            const url = buildAssetBlobUrl("https://gitlab.com/owner/repo", "feat/branch", "docs/assets/pic.jpg");
            expect(url).toBe("https://gitlab.com/owner/repo/-/blob/feat/branch/docs/assets/pic.jpg?ref_type=heads");
        });
    });

    describe("taskSlug and docsRelativePath", () => {
        it("taskSlug returns a slug", () => {
            const task = { title: "Fix This Issue", id: "t1" } as any;
            expect(taskSlug(task)).toBe("fix-this-issue");
        });

        it("docsRelativePath formats the path", () => {
            const task = { title: "My Task", id: "t2" } as any;
            expect(docsRelativePath(task)).toBe("docs/tasks/my-task.md");
        });
    });
});
