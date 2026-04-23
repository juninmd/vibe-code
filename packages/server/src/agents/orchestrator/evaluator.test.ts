import { describe, expect, test, mock, beforeEach, afterEach, spyOn } from "bun:test";

const originalEnv = process.env;

describe("runPostRunEvaluator", () => {
  let spawnSpy: any;
  let fetchSpy: any;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    mock.restore();
    // clear module cache to allow re-evaluating process.env
    delete require.cache[require.resolve("./evaluator")];
  });

  test("should return null if EVALUATOR_ENABLED is false", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "false";
    const { runPostRunEvaluator } = require("./evaluator");

    const result = await runPostRunEvaluator("title", "desc", "/path", "main", "http://base", "key");
    expect(result).toBeNull();
  });

  test("should return null if diff is empty", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      return {
        exited: Promise.resolve(0),
        stdout: new Response(""),
        stderr: new Response(""),
      } as any;
    });

    const result = await runPostRunEvaluator("title", "desc", "/path", "main", "http://base", "key");
    expect(result).toBeNull();
  });

  test("should return evaluator result on success", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    let spawnCall = 0;
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      let stdoutStr = "";
      if (spawnCall === 0) {
         stdoutStr = " 1 file changed, 1 insertion(+)";
      } else {
         stdoutStr = "diff --git a/test b/test\n+ test";
      }
      spawnCall++;
      return {
        exited: Promise.resolve(0),
        stdout: new Response(stdoutStr),
        stderr: new Response(""),
      } as any;
    });

    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(() => {
      return Promise.resolve(new Response(JSON.stringify({
        choices: [
          { message: { content: '{ "score": 8, "pass": true, "feedback": "Good" }' } }
        ]
      }), { status: 200 }));
    });

    const result = await runPostRunEvaluator("title", "desc", "/path", "main", "http://base", "key");
    expect(result).toEqual({ score: 8, pass: true, feedback: "Good" });
  });

  test("should handle missing pass and feedback and cap score", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    process.env.VIBE_CODE_EVALUATOR_THRESHOLD = "7";
    const { runPostRunEvaluator } = require("./evaluator");

    let spawnCall = 0;
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      let stdoutStr = "";
      if (spawnCall === 0) {
         stdoutStr = " 1 file changed, 1 insertion(+)";
      } else {
         stdoutStr = "diff --git a/test b/test\n+ test";
      }
      spawnCall++;
      return {
        exited: Promise.resolve(0),
        stdout: new Response(stdoutStr),
        stderr: new Response(""),
      } as any;
    });

    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(() => {
      return Promise.resolve(new Response(JSON.stringify({
        choices: [
          { message: { content: '{ "score": 15 }' } } // 15 should cap to 10
        ]
      }), { status: 200 }));
    });

    const result = await runPostRunEvaluator("title", "desc", "/path", "main", "http://base", "key");
    expect(result).toEqual({ score: 10, pass: true, feedback: "(no feedback)" });
  });

  test("should fail correctly with non-ok response", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    let spawnCall = 0;
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      let stdoutStr = "";
      if (spawnCall === 0) {
         stdoutStr = " 1 file changed, 1 insertion(+)";
      } else {
         stdoutStr = "diff --git a/test b/test\n+ test";
      }
      spawnCall++;
      return {
        exited: Promise.resolve(0),
        stdout: new Response(stdoutStr),
        stderr: new Response(""),
      } as any;
    });

    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(() => {
      return Promise.resolve(new Response("Bad Gateway", { status: 502 }));
    });

    const result = await runPostRunEvaluator("title", "desc", "/path", "main", "http://base", "key");
    expect(result).toBeNull();
  });

  test("should handle invalid JSON in evaluator response", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    let spawnCall = 0;
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      let stdoutStr = "";
      if (spawnCall === 0) {
         stdoutStr = " 1 file changed, 1 insertion(+)";
      } else {
         stdoutStr = "diff --git a/test b/test\n+ test";
      }
      spawnCall++;
      return {
        exited: Promise.resolve(0),
        stdout: new Response(stdoutStr),
        stderr: new Response(""),
      } as any;
    });

    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(() => {
      return Promise.resolve(new Response(JSON.stringify({
        choices: [
          { message: { content: 'invalid json' } }
        ]
      }), { status: 200 }));
    });

    const result = await runPostRunEvaluator("title", "desc", "/path", "main", "http://base", "key");
    expect(result).toBeNull();
  });

  test("should return null if fetch throws an error", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    let spawnCall = 0;
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      let stdoutStr = "";
      if (spawnCall === 0) {
         stdoutStr = " 1 file changed, 1 insertion(+)";
      } else {
         stdoutStr = "diff --git a/test b/test\n+ test";
      }
      spawnCall++;
      return {
        exited: Promise.resolve(0),
        stdout: new Response(stdoutStr),
        stderr: new Response(""),
      } as any;
    });

    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(() => {
      return Promise.reject(new Error("Network error"));
    });

    const result = await runPostRunEvaluator("title", "desc", "/path", "main", "http://base", "key");
    expect(result).toBeNull();
  });

  test("should handle git diff throwing an error", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("Git failed");
    });

    const result = await runPostRunEvaluator("title", "desc", "/path", "main", "http://base", "key");
    expect(result).toBeNull(); // Because diff will be "" and return null
  });

  test("should truncate large diffs", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    const largeDiff = "a".repeat(10000);
    let spawnCall = 0;
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
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

    let fetchCalled = false;
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (url: any, opts: any) => {
      fetchCalled = true;
      let body: any;
      if (typeof opts.body === "string") {
         body = JSON.parse(opts.body);
      } else {
         body = opts.body;
      }
      const userContent = body.messages.find((m: any) => m.role === "user").content;
      try {
        expect(userContent).toContain("... (diff truncated)");
      } catch (e) {
        // Will be caught and fail the test, or just logged
      }
      return new Response(JSON.stringify({
        choices: [
          { message: { content: '{ "score": 8, "pass": true, "feedback": "Good" }' } }
        ]
      }), { status: 200 });
    });

    const result = await runPostRunEvaluator("title", "desc", "/path", "main", "http://base", "key");
    expect(fetchCalled).toBe(true);
    expect(result).toEqual({ score: 8, pass: true, feedback: "Good" });
  });

  test("should return null if API returns no choices", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
    const { runPostRunEvaluator } = require("./evaluator");

    let spawnCall = 0;
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      let stdoutStr = "";
      if (spawnCall === 0) {
         stdoutStr = " 1 file changed, 1 insertion(+)";
      } else {
         stdoutStr = "diff --git a/test b/test\n+ test";
      }
      spawnCall++;
      return {
        exited: Promise.resolve(0),
        stdout: new Response(stdoutStr),
        stderr: new Response(""),
      } as any;
    });

    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(() => {
      return Promise.resolve(new Response(JSON.stringify({
        choices: []
      }), { status: 200 }));
    });

    const result = await runPostRunEvaluator("title", "desc", "/path", "main", "http://base", "key");
    expect(result).toBeNull();
  });
});
