import { describe, expect, it } from "bun:test";
import { addBacklogComment, fetchBacklog } from "../connectors/backlog";
import { createConnectorsRouter } from "./connectors";

const respond =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status });

describe("backlog connectors", () => {
  it("normalises each tracker", async () => {
    const linear = await fetchBacklog(
      { kind: "linear", token: "t" },
      respond({
        data: { issues: { nodes: [{ id: "1", title: "A", description: null, url: "u" }] } },
      }) as any
    );
    expect(linear[0]).toMatchObject({ externalId: "1", title: "A", source: "linear" });
    const asana = await fetchBacklog(
      { kind: "asana", token: "t", scope: "p" },
      respond({
        data: [
          { gid: "9", name: "N", completed: false },
          { gid: "8", name: "D", completed: true },
        ],
      }) as any
    );
    expect(asana.map((i) => i.externalId)).toEqual(["9"]);
    const notion = await fetchBacklog(
      { kind: "notion", token: "t", scope: "d" },
      respond({
        results: [
          {
            id: "n",
            url: "u",
            properties: { Name: { type: "title", title: [{ plain_text: "Hi" }] } },
          },
        ],
      }) as any
    );
    expect(notion[0]?.title).toBe("Hi");
    const trello = await fetchBacklog(
      { kind: "trello", token: "t", scope: "l", extra: "k" },
      respond([{ id: "c", name: "C", desc: "d", shortUrl: "s" }]) as any
    );
    expect(trello[0]?.description).toBe("d");
  });
  it("throws on API errors and refuses empty comments", async () => {
    await expect(
      fetchBacklog({ kind: "clickup", token: "t", scope: "l" }, respond({}, 401) as any)
    ).rejects.toThrow("ClickUp");
    expect(await addBacklogComment({ kind: "jira", token: "" }, "X-1", "hi")).toBe(false);
  });
  it("comments via fetch", async () => {
    expect(
      await addBacklogComment({ kind: "clickup", token: "t" }, "1", "hi", respond({}) as any)
    ).toBe(true);
    expect(
      await addBacklogComment(
        { kind: "linear", token: "t" },
        "1",
        "hi",
        respond({ data: { commentCreate: { success: true } } }) as any
      )
    ).toBe(true);
  });
  it("router validates input", async () => {
    const app = createConnectorsRouter(respond({ tasks: [] }) as any);
    const bad = await app.request("/backlog", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    expect(bad.status).toBe(400);
    const ok = await app.request("/backlog", {
      method: "POST",
      body: JSON.stringify({ kind: "clickup", token: "t", scope: "l" }),
      headers: { "content-type": "application/json" },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ items: [] });
  });
});
