import { expect, test, describe } from "bun:test";
import { discoverValidationCommands } from "./verify";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("discoverValidationCommands - package.json", () => {
  test("detects validation commands from package.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vibe-verify-"));
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          scripts: {
            lint: "eslint .",
            test: "jest",
            "test:e2e": "playwright test",
            build: "vite build",
          },
        }),
        "utf8"
      );

      const commands = await discoverValidationCommands(dir);
      expect(commands.map((c) => c.command)).toEqual([
        "bun install",
        "bun run lint",
        "bun run test",
        "bun run build",
      ]);
      expect(commands.every((c) => c.source === "package_json")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("discoverValidationCommands - extra", () => {
  test("detects validation commands from Makefile when package.json is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vibe-verify-"));
    try {
      await writeFile(
        join(dir, "Makefile"),
        "test:\n\tjest\nlint:\n\teslint .\nbuild:\n\tvite build\nvalidate:\n\tvalidate\n",
        "utf8"
      );

      const commands = await discoverValidationCommands(dir);
      expect(commands.map((c) => c.command)).toEqual(["make test", "make lint", "make validate"]);
      expect(commands.every((c) => c.source === "detected")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("detects validation commands from README.md bash blocks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vibe-verify-"));
    try {
      await writeFile(
        join(dir, "README.md"),
        [
          "# Project",
          "Run the tests with:",
          "```bash",
          "npm run test:e2e",
          "bun run format",
          "```",
        ].join("\n"),
        "utf8"
      );

      const commands = await discoverValidationCommands(dir);
      expect(commands.map((c) => c.command)).toEqual(["npm run test:e2e", "bun run format"]);
      expect(commands.every((c) => c.source === "detected")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("throws an error when no validation commands can be discovered", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vibe-verify-"));
    try {
      await expect(discoverValidationCommands(dir)).rejects.toThrow(
        "Verification failed: unable to discover validation commands from WORKFLOW.md or package.json"
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
