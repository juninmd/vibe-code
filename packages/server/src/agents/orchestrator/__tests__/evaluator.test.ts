import { describe, expect, it, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { runPostRunEvaluator } from "../evaluator";

describe("evaluator", () => {
  beforeEach(() => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.VIBE_CODE_EVALUATOR_ENABLED;
    mock.restore();
  });

  it("should return null if evaluator is disabled", async () => {
    process.env.VIBE_CODE_EVALUATOR_ENABLED = "false";
    const result = await runPostRunEvaluator("title", "desc", "/wt", "main", "http://localhost", "key");
    expect(result).toBeNull();
  });

  it("should return null if git diff is empty", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      return {
        exited: Promise.resolve(0),
        stdout: new Blob([""]).stream(),
        stderr: new Blob([""]).stream(),
      } as any;
    });

    const result = await runPostRunEvaluator("title", "desc", "/wt", "main", "http://localhost", "key");
    expect(result).toBeNull();
  });

  it("should run evaluator and parse valid JSON response", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      return {
        exited: Promise.resolve(0),
        stdout: new Blob(["diff data"]).stream(),
        stderr: new Blob([""]).stream(),
      } as any;
    });

    const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ score: 9, pass: true, feedback: "good" }) } }]
    })));

    const result = await runPostRunEvaluator("title", "desc", "/wt", "main", "http://localhost", "key");

    expect(result).toEqual({ score: 9, pass: true, feedback: "good" });
    expect(mockFetch).toHaveBeenCalled();
  });

  it("should handle truncation of git diff", async () => {
    const longDiff = "a".repeat(9000);
    spyOn(Bun, "spawn").mockImplementation((args: any) => {
      if (args[args.length - 1] === "--stat") {
        return {
          exited: Promise.resolve(0),
          stdout: new Blob(["stat data"]).stream(),
          stderr: new Blob([""]).stream(),
        } as any;
      }
      return {
        exited: Promise.resolve(0),
        stdout: new Blob([longDiff]).stream(),
        stderr: new Blob([""]).stream(),
      } as any;
    });

    const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ score: 5, pass: false, feedback: "bad" }) } }]
    })));

    const result = await runPostRunEvaluator("title", "desc", "/wt", "main", "http://localhost", "key");

    expect(result).toEqual({ score: 5, pass: false, feedback: "bad" });

    // the diff gets truncated to 8000 chars, so the fetch body will contain "diff truncated"
    const callArgs = (mockFetch as any).mock.calls[0];
    const fetchOptions = callArgs[1];
    const bodyObj = JSON.parse(fetchOptions.body);
    expect(bodyObj.messages[1].content).toContain("... (diff truncated)");
  });

  it("should return null if API fails", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      return {
        exited: Promise.resolve(0),
        stdout: new Blob(["diff data"]).stream(),
        stderr: new Blob([""]).stream(),
      } as any;
    });

    spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network Error"));

    const result = await runPostRunEvaluator("title", "desc", "/wt", "main", "http://localhost", "key");
    expect(result).toBeNull();
  });

  it("should handle invalid JSON from API", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      return {
        exited: Promise.resolve(0),
        stdout: new Blob(["diff data"]).stream(),
        stderr: new Blob([""]).stream(),
      } as any;
    });

    spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "invalid json" } }]
    })));

    const result = await runPostRunEvaluator("title", "desc", "/wt", "main", "http://localhost", "key");
    expect(result).toBeNull();
  });

  it("should return null if API returns non-ok status", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      return {
        exited: Promise.resolve(0),
        stdout: new Blob(["diff data"]).stream(),
        stderr: new Blob([""]).stream(),
      } as any;
    });

    spyOn(globalThis, "fetch").mockResolvedValue(new Response("error", { status: 500 }));

    const result = await runPostRunEvaluator("title", "desc", "/wt", "main", "http://localhost", "key");
    expect(result).toBeNull();
  });
});
