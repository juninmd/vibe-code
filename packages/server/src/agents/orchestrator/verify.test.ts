import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeRunQualityScore, discoverValidationCommands } from "./verify";

describe("discoverValidationCommands", () => {
  it("prefers WORKFLOW.md quality gate commands when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vibe-verify-"));
    try {
      await writeFile(
        join(dir, "WORKFLOW.md"),
        [
          "# Workflow Contract",
          "",
          "## Current Quality Gate",
          "",
          "```bash",
          "bun run lint",
          "bun run typecheck",
          "bun run test",
          "bun run build",
          "```",
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { lint: "eslint .", build: "vite build" } }),
        "utf8"
      );

      const commands = await discoverValidationCommands(dir);
      expect(commands.map((command) => command.command)).toEqual([
        "bun run lint",
        "bun run typecheck",
        "bun run test",
        "bun run build",
      ]);
      expect(commands.every((command) => command.source === "workflow")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to package.json scripts when no workflow contract exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vibe-verify-"));
    try {
      await mkdir(join(dir, "node_modules"), { recursive: true });
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          packageManager: "bun@1.3.0",
          scripts: {
            lint: "biome check .",
            test: "vitest run",
            build: "vite build",
          },
        }),
        "utf8"
      );

      const commands = await discoverValidationCommands(dir);
      expect(commands.map((command) => command.command)).toEqual([
        "bun run lint",
        "bun run test",
        "bun run build",
      ]);
      expect(commands.every((command) => command.source === "package_json")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prepends bun install when no node_modules folder exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vibe-verify-"));
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          packageManager: "bun@1.3.0",
          scripts: {
            lint: "biome check .",
            test: "vitest run",
            build: "vite build",
          },
        }),
        "utf8"
      );

      const commands = await discoverValidationCommands(dir);
      expect(commands.map((command) => command.command)).toEqual([
        "bun install",
        "bun run lint",
        "bun run test",
        "bun run build",
      ]);
      expect(commands.every((command) => command.source === "package_json")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("discoverValidationCommands - extra", () => {
  it("detects validation commands from Makefile when package.json is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vibe-verify-"));
    try {
      await writeFile(
        join(dir, "Makefile"),
        "test:\n\tjest\nlint:\n\teslint .\nbuild:\n\tvite build\n",
        "utf8"
      );

      const commands = await discoverValidationCommands(dir);
      expect(commands.map((c) => c.command)).toEqual(["make test", "make lint"]);
      expect(commands.every((c) => c.source === "detected")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects validation commands from README.md bash blocks", async () => {
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

  it("throws an error when no validation commands can be discovered", async () => {
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

describe("computeRunQualityScore", () => {
  it("reduces score for retries and review findings", () => {
    const score = computeRunQualityScore({
      validatorAttempts: 3,
      reviewBlockers: 1,
      reviewWarnings: 2,
      finalStatus: "completed",
      prCreated: true,
    });

    expect(score).toBe(61);
  });

  it("clamps score to the 0..100 range", () => {
    const score = computeRunQualityScore({
      validatorAttempts: 8,
      reviewBlockers: 5,
      reviewWarnings: 10,
      finalStatus: "failed",
      prCreated: false,
    });

    expect(score).toBe(0);
  });
});
