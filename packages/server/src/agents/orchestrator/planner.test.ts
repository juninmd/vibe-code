import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runPlannerIfNeeded } from "./planner";

describe("runPlannerIfNeeded", () => {
  let fetchSpy: ReturnType<typeof spyOn>;
  let writeFileSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Enable planner config
    process.env.VIBE_CODE_PLANNER_ENABLED = "true";
    process.env.VIBE_CODE_PLANNER_MIN_CHARS = "200";

    fetchSpy = spyOn(global, "fetch").mockImplementation((async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "# Expanded Spec\nThis is the expanded task spec.",
              },
            },
          ],
        }),
        { status: 200 }
      );
    }) as any);

    writeFileSpy = spyOn(fs, "writeFile").mockImplementation(async () => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    writeFileSpy.mockRestore();
    delete process.env.VIBE_CODE_PLANNER_ENABLED;
    delete process.env.VIBE_CODE_PLANNER_MIN_CHARS;
  });

  test("returns null if explicitly disabled", async () => {
    process.env.VIBE_CODE_PLANNER_ENABLED = "false";
    const result = await runPlannerIfNeeded(
      "Task Title",
      "Short desc",
      "/wt",
      "http://litellm",
      "key"
    );
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns null if description is long enough", async () => {
    const longDesc = "A".repeat(250);
    const result = await runPlannerIfNeeded("Task Title", longDesc, "/wt", "http://litellm", "key");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns spec and writes to file on success", async () => {
    const result = await runPlannerIfNeeded(
      "Task Title",
      "Short desc",
      "/wt",
      "http://litellm",
      "key"
    );

    expect(result).toEqual({
      spec: "# Expanded Spec\nThis is the expanded task spec.",
      specPath: path.join("/wt", ".vibe-code", "context", "SPEC.md"),
    });

    expect(fetchSpy).toHaveBeenCalled();
    expect(writeFileSpy).toHaveBeenCalledWith(
      path.join("/wt", ".vibe-code", "context", "SPEC.md"),
      "# Expanded Spec\nThis is the expanded task spec.",
      "utf8"
    );
  });

  test("returns null if fetch fails", async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response("Internal Server Error", { status: 500 });
    });

    const result = await runPlannerIfNeeded(
      "Task Title",
      "Short desc",
      "/wt",
      "http://litellm",
      "key"
    );
    expect(result).toBeNull();
  });

  test("returns null if fetch throws", async () => {
    fetchSpy.mockImplementation(async () => {
      throw new Error("Network Error");
    });

    const result = await runPlannerIfNeeded(
      "Task Title",
      "Short desc",
      "/wt",
      "http://litellm",
      "key"
    );
    expect(result).toBeNull();
  });

  test("returns null if writeFile throws", async () => {
    writeFileSpy.mockImplementation(async () => {
      throw new Error("Permission Denied");
    });

    const result = await runPlannerIfNeeded(
      "Task Title",
      "Short desc",
      "/wt",
      "http://litellm",
      "key"
    );
    expect(result).toBeNull();
  });

  test("handles empty descriptions properly in the prompt", async () => {
    await runPlannerIfNeeded(
      "Task Title",
      "   ", // whitespace only
      "/wt",
      "http://litellm",
      "key"
    );

    const fetchCallArgs = fetchSpy.mock.calls[0];
    const fetchBody = JSON.parse(fetchCallArgs[1].body);
    const userPrompt = fetchBody.messages[1].content;

    // Should only have the title, no empty context
    expect(userPrompt).toBe("Task: Task Title");
  });
});
