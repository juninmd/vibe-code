import { describe, expect, it } from "bun:test";
import { promptModel, ServeEventMapper } from "./events";

const SID = "ses_main";
const part = (p: Record<string, unknown>) => ({
  type: "message.part.updated",
  properties: { sessionID: SID, part: { id: "prt_1", sessionID: SID, ...p } },
});

describe("ServeEventMapper", () => {
  it("emits text once, only after it finished streaming", () => {
    const mapper = new ServeEventMapper(SID);
    expect(mapper.map(part({ type: "text", text: "Vou", time: { start: 1 } }))).toEqual([]);
    const done = part({ type: "text", text: "Vou criar.", time: { start: 1, end: 2 } });
    expect(mapper.map(done)).toEqual([
      { kind: "line", line: { type: "text", part: done.properties.part } },
    ]);
    // The bus repeats a finished part on later updates.
    expect(mapper.map(done)).toEqual([]);
  });

  it("skips the prompt echo, which has no timing", () => {
    expect(new ServeEventMapper(SID).map(part({ type: "text", text: "Create it" }))).toEqual([]);
  });

  it("waits for a tool to complete or fail before emitting it as a run line", () => {
    const mapper = new ServeEventMapper(SID);
    expect(mapper.map(part({ type: "tool", tool: "write", state: { status: "running" } }))).toEqual(
      []
    );
    const [line] = mapper.map(part({ type: "tool", tool: "write", state: { status: "error" } }));
    expect(line).toMatchObject({ kind: "line", line: { type: "tool_use" } });
  });

  it("ignores parts from other sessions but still surfaces their permission asks", () => {
    const mapper = new ServeEventMapper(SID);
    const other = {
      type: "message.part.updated",
      properties: { sessionID: "ses_child", part: { id: "x", type: "step-start" } },
    };
    expect(mapper.map(other)).toEqual([]);
    const ask = {
      type: "permission.asked",
      properties: { id: "per_1", sessionID: "ses_child", permission: "edit", patterns: ["a"] },
    };
    expect(mapper.map(ask)).toEqual([{ kind: "permission", request: ask.properties as never }]);
  });

  it("logs each retry once and turns an operator action into an error instead of retrying forever", () => {
    const mapper = new ServeEventMapper(SID);
    const retry = {
      type: "session.status",
      properties: {
        sessionID: SID,
        status: { type: "retry", attempt: 1, message: "rate limited" },
      },
    };
    expect(mapper.map(retry)).toHaveLength(1);
    expect(mapper.map(retry)).toEqual([]);
    const blocked = {
      type: "session.status",
      properties: {
        sessionID: SID,
        status: {
          type: "retry",
          attempt: 1,
          message: "Free usage exceeded",
          action: { title: "Free limit reached", message: "Subscribe" },
        },
      },
    };
    expect(mapper.map(blocked)).toEqual([
      { kind: "error", message: "Free limit reached: Subscribe" },
    ]);
  });

  it("ends the turn on idle and reports session errors", () => {
    const mapper = new ServeEventMapper(SID);
    expect(mapper.map({ type: "session.idle", properties: { sessionID: SID } })).toEqual([
      { kind: "idle" },
    ]);
    expect(mapper.map({ type: "session.idle", properties: { sessionID: "other" } })).toEqual([]);
    expect(
      mapper.map({
        type: "session.error",
        properties: { sessionID: SID, error: { name: "APIError", data: { message: "bad key" } } },
      })
    ).toEqual([{ kind: "error", message: "bad key" }]);
  });

  it("joins question texts so the skipped question stays visible", () => {
    const [mapped] = new ServeEventMapper(SID).map({
      type: "question.asked",
      properties: { id: "q1", sessionID: SID, questions: [{ question: "Qual banco?" }] },
    });
    expect(mapped).toEqual({
      kind: "question",
      request: { id: "q1", sessionID: SID, text: "Qual banco?" },
    });
  });
});

describe("promptModel", () => {
  it("splits on the first slash so model ids keep theirs", () => {
    expect(promptModel("litellm/cloud/auto#high")).toEqual({
      model: { providerID: "litellm", modelID: "cloud/auto" },
      variant: "high",
    });
  });

  it("leaves the model to OpenCode when none or no provider is given", () => {
    expect(promptModel(undefined)).toEqual({});
    expect(promptModel("auto-free")).toEqual({});
    expect(promptModel("gpt")).toEqual({});
    expect(promptModel("/x")).toEqual({});
  });
});
