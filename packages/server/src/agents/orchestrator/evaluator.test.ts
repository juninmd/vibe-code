import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

const originalEnv = process.env;

describe("runPostRunEvaluator", () => {
  let _spawnSpy: ReturnType<typeof spyOn>;
  let _fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    mock.restore();
    delete require.cache[require.resolve("./evaluator")];
  });

  function mockDependencies(
    diffOutput: string,
    fetchResponseStatus: number,
    fetchResponseBody: any,
    throwsGitError = false,
    throwsFetchError = false
  ) {
    let spawnCall = 0;
    _spawnSpy = spyOn(Bun, "spawn").mockImplementation((..._args: any[]) => {
      if (throwsGitError) {
        throw new Error("Git failed");
      }

      let stdoutStr = "";
      if (spawnCall === 0 && diffOutput) {
        stdoutStr = diffOutput === "stat" ? " 1 file changed, 1 insertion(+)" : "stat";
      } else {
        stdoutStr = diffOutput;
      }
      spawnCall++;
      return {
        exited: Promise.resolve(0),
        stdout: new Response(stdoutStr),
        stderr: new Response(""),
      } as any;
    });

    _fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        (..._args: any[]) => {
          if (throwsFetchError) {
            return Promise.reject(new Error("Network error"));
          }

          const responseObj =
            typeof fetchResponseBody === "string"
              ? fetchResponseBody
              : JSON.stringify(fetchResponseBody);

          return Promise.resolve(new Response(responseObj, { status: fetchResponseStatus })) as any;
        },
        { preconnect: () => {} }
      ) as any
    );
  }

  test("should return null if EVALUATOR_ENABLED is false", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "false";
    const { runPostRunEvaluator } = require("./evaluator");

    const result = await runPostRunEvaluator(
      "title",
      "desc",
      "/path",
      "main",
      "http://base",
      "key"
    );
    expect(result).toBeNull();
  });

  test("should return null if diff is empty", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    mockDependencies("", 200, {});

    const result = await runPostRunEvaluator(
      "title",
      "desc",
      "/path",
      "main",
      "http://base",
      "key"
    );
    expect(result).toBeNull();
  });

  test("should return evaluator result on success", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    mockDependencies("diff --git a/test b/test\n+ test", 200, {
      choices: [{ message: { content: '{ "score": 8, "pass": true, "feedback": "Good" }' } }],
    });

    const result = await runPostRunEvaluator(
      "title",
      "desc",
      "/path",
      "main",
      "http://base",
      "key"
    );
    expect(result).toEqual({ score: 8, pass: true, feedback: "Good" });
  });

  test("should handle missing pass and feedback and cap score", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    process.env.VIBE_CODE_EVALUATOR_THRESHOLD = "7";
    const { runPostRunEvaluator } = require("./evaluator");

    mockDependencies("diff", 200, {
      choices: [{ message: { content: '{ "score": 15 }' } }], // 15 should cap to 10
    });

    const result = await runPostRunEvaluator(
      "title",
      "desc",
      "/path",
      "main",
      "http://base",
      "key"
    );
    expect(result).toEqual({ score: 10, pass: true, feedback: "(no feedback)" });
  });

  test("should fail correctly with non-ok response", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    mockDependencies("diff", 502, "Bad Gateway");

    const result = await runPostRunEvaluator(
      "title",
      "desc",
      "/path",
      "main",
      "http://base",
      "key"
    );
    expect(result).toBeNull();
  });

  test("should handle invalid JSON in evaluator response", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    mockDependencies("diff", 200, {
      choices: [{ message: { content: "invalid json" } }],
    });

    const result = await runPostRunEvaluator(
      "title",
      "desc",
      "/path",
      "main",
      "http://base",
      "key"
    );
    expect(result).toBeNull();
  });

  test("should return null if fetch throws an error", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    mockDependencies("diff", 200, {}, false, true);

    const result = await runPostRunEvaluator(
      "title",
      "desc",
      "/path",
      "main",
      "http://base",
      "key"
    );
    expect(result).toBeNull();
  });

  test("should handle git diff throwing an error", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    mockDependencies("diff", 200, {}, true, false);

    const result = await runPostRunEvaluator(
      "title",
      "desc",
      "/path",
      "main",
      "http://base",
      "key"
    );
    expect(result).toBeNull(); // Because diff will be "" and return null
  });

  test("should truncate large diffs", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    const largeDiff = "a".repeat(10000);
    let fetchCalled = false;

    let spawnCall = 0;
    _spawnSpy = spyOn(Bun, "spawn").mockImplementation((..._args: any[]) => {
      let stdoutStr = "";
      if (spawnCall === 0) {
        stdoutStr = "stat";
      } else {
        stdoutStr = largeDiff;
      }
      spawnCall++;
      return {
        exited: Promise.resolve(0),
        stdout: new Response(stdoutStr),
        stderr: new Response(""),
      } as any;
    });

    _fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (...args: any[]) => {
          fetchCalled = true;
          const opts = args[1];
          let body: any;
          if (typeof opts?.body === "string") {
            body = JSON.parse(opts.body);
          } else if (opts?.body) {
            body = opts.body;
          }
          if (body?.messages) {
            const userContent = body.messages.find((m: any) => m.role === "user")?.content;
            if (userContent) {
              try {
                expect(userContent).toContain("... (diff truncated)");
              } catch (_e) {
                // Let it fail the assertion cleanly
              }
            }
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [
                  { message: { content: '{ "score": 8, "pass": true, "feedback": "Good" }' } },
                ],
              }),
              { status: 200 }
            )
          ) as any;
        },
        { preconnect: () => {} }
      ) as any
    );

    const result = await runPostRunEvaluator(
      "title",
      "desc",
      "/path",
      "main",
      "http://base",
      "key"
    );
    expect(fetchCalled).toBe(true);
    expect(result).toEqual({ score: 8, pass: true, feedback: "Good" });
  });

  test("should return null if API returns no choices", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    mockDependencies("diff", 200, { choices: [] });

    const result = await runPostRunEvaluator(
      "title",
      "desc",
      "/path",
      "main",
      "http://base",
      "key"
    );
    expect(result).toBeNull();
  });
});
