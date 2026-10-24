import { describe, expect, it, mock } from "bun:test";
import { streamProcess } from "../stream-process";

describe("streamProcess", () => {
  it("should stream stdout and stderr and yield events", async () => {
    const proc = {
      stdout: new Blob(["out line 1\nout line 2\n"]).stream(),
      stderr: new Blob(["err line 1\n"]).stream(),
      exited: Promise.resolve(0),
      kill: mock(),
    };

    const parseLine = (line: string) => {
      return [{ type: "log", stream: "stdout", content: line }] as any;
    };

    const events = [];
    for await (const event of streamProcess(proc as any, parseLine)) {
      events.push(event);
    }

    expect(events.length).toBe(4);
    expect(events).toContainEqual({ type: "log", stream: "stdout", content: "out line 1" });
    expect(events).toContainEqual({ type: "log", stream: "stdout", content: "out line 2" });
    expect(events).toContainEqual({ type: "log", stream: "stderr", content: "err line 1" });
    expect(events).toContainEqual({ type: "complete", exitCode: 0 });
  });

  it("should parse leftover buffers", async () => {
    const proc = {
      stdout: new Blob(["out no newline"]).stream(),
      stderr: new Blob(["err no newline"]).stream(),
      exited: Promise.resolve(0),
      kill: mock(),
    };

    const parseLine = (line: string) => {
      return [{ type: "log", stream: "stdout", content: line }] as any;
    };

    const events = [];
    for await (const event of streamProcess(proc as any, parseLine)) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "log", stream: "stdout", content: "out no newline" });
    expect(events).toContainEqual({ type: "log", stream: "stderr", content: "err no newline" });
  });

  it("should handle progress renders with carriage returns", async () => {
    const proc = {
      stdout: new Blob(["progress 1\rprogress 2\r\n"]).stream(),
      stderr: new Blob([""]).stream(),
      exited: Promise.resolve(0),
      kill: mock(),
    };

    const parseLine = (line: string) => {
      return [{ type: "log", stream: "stdout", content: line }] as any;
    };

    const events = [];
    for await (const event of streamProcess(proc as any, parseLine)) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "log", stream: "stdout", content: "progress 1" });
    expect(events).toContainEqual({ type: "log", stream: "stdout", content: "progress 2" });
  });

  it("should handle non-zero exit code", async () => {
    const proc = {
      stdout: new Blob([""]).stream(),
      stderr: new Blob([""]).stream(),
      exited: Promise.resolve(1),
      kill: mock(),
    };

    const parseLine = (line: string) => [];

    const events = [];
    for await (const event of streamProcess(proc as any, parseLine)) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "log",
      stream: "stderr",
      content: "[process] Exited with code 1",
    });
    expect(events).toContainEqual({ type: "complete", exitCode: 1 });
  });

  it("should handle abort signal properly", async () => {
    const proc = {
      stdout: new Blob(["line1\n", "line2\n"]).stream(),
      stderr: new Blob([""]).stream(),
      exited: new Promise((resolve) => setTimeout(() => resolve(0), 100)),
      kill: mock(),
    };

    const parseLine = (line: string) => {
      return [{ type: "log", stream: "stdout", content: line }] as any;
    };

    const controller = new AbortController();

    setTimeout(() => controller.abort(), 10);

    const events = [];
    for await (const event of streamProcess(proc as any, parseLine, controller.signal)) {
      events.push(event);
    }

    expect(proc.kill).toHaveBeenCalled();
  });
});
