import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { cleanupWorkspaces, listProtectedWorkspaces } from "../workspace-cleanup";

describe("workspace-cleanup", () => {
  beforeEach(() => {
    spyOn(fsPromises, "rm").mockResolvedValue(undefined);
  });

  afterEach(() => {
    mock.restore();
  });

  describe("listProtectedWorkspaces", () => {
    it("should return a set of protected workspace paths", () => {
      const mockDb = {
        raw: {
          query: mock().mockReturnValue({
            all: mock().mockReturnValue([{ path: "/tmp/wt1" }, { path: "/tmp/wt2" }]),
          }),
        },
      };

      const result = listProtectedWorkspaces(mockDb as any);

      expect(result.size).toBe(2);
      expect(result.has(path.resolve("/tmp/wt1"))).toBe(true);
      expect(result.has(path.resolve("/tmp/wt2"))).toBe(true);
    });
  });

  describe("cleanupWorkspaces", () => {
    it("should remove stale workspaces and keep protected ones", async () => {
      const mockDb = {
        raw: {
          query: mock().mockReturnValue({
            all: mock().mockReturnValue([{ path: "/workspaces/repo1/wt1" }]),
          }),
        },
      };

      spyOn(fsPromises, "readdir").mockImplementation(async (dirPath: any) => {
        if (dirPath === "/workspaces") {
          return [
            { name: "repo1", isDirectory: () => true },
            { name: "repo2", isDirectory: () => true },
            { name: "file.txt", isDirectory: () => false },
          ] as any;
        }
        if (dirPath === path.join("/workspaces", "repo1")) {
          return [
            { name: "wt1", isDirectory: () => true },
            { name: "wt2", isDirectory: () => true },
          ] as any;
        }
        if (dirPath === path.join("/workspaces", "repo2")) {
          return [{ name: "wt3", isDirectory: () => true }] as any;
        }
        return [];
      });

      const result = await cleanupWorkspaces(mockDb as any, "/workspaces");

      expect(result.removed).toBe(2);
      expect(result.kept).toBe(1);

      // Verify rm calls
      expect(fsPromises.rm).toHaveBeenCalledWith(path.join("/workspaces", "repo1", "wt2"), {
        recursive: true,
        force: true,
      });
      expect(fsPromises.rm).toHaveBeenCalledWith(path.join("/workspaces", "repo2", "wt3"), {
        recursive: true,
        force: true,
      });
      // Should remove empty repo2
      expect(fsPromises.rm).toHaveBeenCalledWith(path.join("/workspaces", "repo2"), {
        recursive: true,
        force: true,
      });

      // Should not remove protected wt1
      expect(
        (fsPromises.rm as any).mock.calls.some(
          (args: any) => args[0] === path.join("/workspaces", "repo1", "wt1")
        )
      ).toBe(false);
      // Should not remove non-empty repo1
      expect(
        (fsPromises.rm as any).mock.calls.some(
          (args: any) => args[0] === path.join("/workspaces", "repo1")
        )
      ).toBe(false);
    });

    it("should handle readdir errors gracefully", async () => {
      const mockDb = {
        raw: {
          query: mock().mockReturnValue({ all: mock().mockReturnValue([]) }),
        },
      };

      spyOn(fsPromises, "readdir").mockRejectedValue(new Error("ENOENT"));

      const result = await cleanupWorkspaces(mockDb as any, "/workspaces");

      expect(result.removed).toBe(0);
      expect(result.kept).toBe(0);
    });
  });
});
