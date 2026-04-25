import { expect, test, describe, mock, spyOn, afterEach, beforeEach } from "bun:test";
import { runPostRunEvaluator } from "./evaluator";

describe("runPostRunEvaluator", () => {
  let spawnSpy: ReturnType<typeof spyOn>;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Enable evaluator
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    process.env.VIBE_CODE_EVALUATOR_THRESHOLD = "7";

    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: any) => {
      const output = args.includes("--stat")
        ? " 1 file changed, 1 insertion(+)"
        : "+ added line";

      return {
        exited: Promise.resolve(0),
        stdout: new Blob([output]).stream(),
        stderr: new Blob([""]).stream(),
      } as any;
    });

    fetchSpy = spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  score: 8,
                  pass: true,
                  feedback: "Good job",
                }),
              },
            },
          ],
        }),
        { status: 200 }
      );
    });
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    fetchSpy.mockRestore();
    delete process.env.VIBE_CODE_EVALUATOR_ENABLED;
    delete process.env.VIBE_CODE_EVALUATOR_THRESHOLD;
  });

  test("returns null if disabled", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "false";
    const result = await runPostRunEvaluator(
      "Task",
      "Desc",
      "/wt",
      "main",
      "http://litellm",
      "key"
    );
    expect(result).toBeNull();
  });

  test("returns null if diff is empty", async () => {
    spawnSpy.mockImplementation(() => {
      return {
        exited: Promise.resolve(0),
        stdout: new Blob([""]).stream(),
      } as any;
    });

    const result = await runPostRunEvaluator(
      "Task",
      "Desc",
      "/wt",
      "main",
      "http://litellm",
      "key"
    );
    expect(result).toBeNull();
  });

  test("returns evaluation result on success", async () => {
    const result = await runPostRunEvaluator(
      "Task",
      "Desc",
      "/wt",
      "main",
      "http://litellm",
      "key"
    );
    expect(result).toEqual({
      score: 8,
      pass: true,
      feedback: "Good job",
    });

    expect(fetchSpy).toHaveBeenCalled();
  });

  test("returns null if fetch fails", async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response("Internal Server Error", { status: 500 });
    });

    const result = await runPostRunEvaluator(
      "Task",
      "Desc",
      "/wt",
      "main",
      "http://litellm",
      "key"
    );
    expect(result).toBeNull();
  });

  test("returns null if fetch throws", async () => {
    fetchSpy.mockImplementation(async () => {
      throw new Error("Network error");
    });

    const result = await runPostRunEvaluator(
      "Task",
      "Desc",
      "/wt",
      "main",
      "http://litellm",
      "key"
    );
    expect(result).toBeNull();
  });

  test("handles invalid JSON response", async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "invalid json",
              },
            },
          ],
        }),
        { status: 200 }
      );
    });

    const result = await runPostRunEvaluator(
      "Task",
      "Desc",
      "/wt",
      "main",
      "http://litellm",
      "key"
    );
    expect(result).toBeNull();
  });

  test("handles missing properties in valid JSON response, bounds score", async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  score: 15, // Out of bounds
                }),
              },
            },
          ],
        }),
        { status: 200 }
      );
    });

    const result = await runPostRunEvaluator(
      "Task",
      "Desc",
      "/wt",
      "main",
      "http://litellm",
      "key"
    );
    expect(result).toEqual({
      score: 10,
      pass: true, // 10 >= 7
      feedback: "(no feedback)",
    });
  });

  test("passes if score >= threshold and pass not explicitly false", async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  score: 5, // Threshold is 7
                }),
              },
            },
          ],
        }),
        { status: 200 }
      );
    });

    const result = await runPostRunEvaluator(
      "Task",
      "Desc",
      "/wt",
      "main",
      "http://litellm",
      "key"
    );
    expect(result).toEqual({
      score: 5,
      pass: false, // 5 < 7
      feedback: "(no feedback)",
    });
  });

  test("handles truncated diff logic", async () => {
    // Generate a very long string > 8000 chars
    const longString = "A".repeat(9000);
    spawnSpy.mockImplementation((args: any) => {
      const output = args.includes("--stat")
        ? " 1 file changed"
        : longString;

      return {
        exited: Promise.resolve(0),
        stdout: new Blob([output]).stream(),
        stderr: new Blob([""]).stream(),
      } as any;
    });

    const result = await runPostRunEvaluator(
      "Task",
      "Desc",
      "/wt",
      "main",
      "http://litellm",
      "key"
    );

    expect(result).not.toBeNull();
    // The fetch payload should contain "... (diff truncated)"
    const fetchCallArgs = fetchSpy.mock.calls[0];
    const fetchBody = JSON.parse(fetchCallArgs[1].body);
    const userPrompt = fetchBody.messages[1].content;
    expect(userPrompt).toContain("... (diff truncated)");
    expect(userPrompt.length).toBeLessThan(10000); // 8000 + some padding
  });

  test("handles git failure", async () => {
    spawnSpy.mockImplementation(() => {
      throw new Error("Git not found");
    });

    const result = await runPostRunEvaluator(
      "Task",
      "Desc",
      "/wt",
      "main",
      "http://litellm",
      "key"
    );
    expect(result).toBeNull();
  });
});
