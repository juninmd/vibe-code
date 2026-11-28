import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createDb } from "../db";
import type { ProviderRegistry } from "../git/providers/registry";
import { LaneSyncService } from "../lanes/lane-sync";
import type { BroadcastHub } from "../ws/broadcast";
import { createLanesRouter } from "./lanes";

function build() {
  const db = createDb(":memory:");
  const lanes = new LaneSyncService({
    db,
    providers: {
      detectProvider: () => "manual",
      resolve: () => null,
    } as unknown as ProviderRegistry,
    hub: { broadcastAll: () => {} } as unknown as BroadcastHub,
    isBusy: () => false,
  });
  const app = new Hono();
  app.route("/api/lanes", createLanesRouter(lanes));
  const put = (body: unknown) =>
    app.request("/api/lanes", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { app, put, lanes };
}

describe("/api/lanes", () => {
  it("starts disabled and tells the UI each provider's default labels", async () => {
    const { app } = build();
    const { data } = await (await app.request("/api/lanes")).json();
    expect(data.enabled).toBe(false);
    expect(data.overrides).toEqual({});
    expect(data.defaults.github.review).toBe("status:review");
    expect(data.defaults.gitlab.review).toBe("status::review");
    expect(data.status).toEqual({ running: false, lastSyncAt: null, repos: [] });
  });

  it("turns the sync on and stores custom label names", async () => {
    const { put, app } = build();
    const res = await put({ enabled: true, labels: { review: "In QA", done: "" } });
    expect(res.status).toBe(200);
    const { data } = await (await app.request("/api/lanes")).json();
    expect(data.enabled).toBe(true);
    expect(data.overrides).toEqual({ review: "In QA" });
  });

  it("returns to the defaults when the labels are cleared", async () => {
    const { put } = build();
    await put({ labels: { review: "In QA" } });
    const res = await put({ labels: {} });
    expect((await res.json()).data.overrides).toEqual({});
  });

  it("rejects clashing, oversized and unknown labels", async () => {
    const { put } = build();
    expect((await put({ labels: { review: "x", done: "X" } })).status).toBe(400);
    expect((await put({ labels: { review: "x".repeat(60) } })).status).toBe(400);
    expect((await put({ labels: { nope: "x" } })).status).toBe(400);
    expect((await put({ enabled: "yes" })).status).toBe(400);
  });

  it("refuses to sync while it is off", async () => {
    const { app } = build();
    const res = await app.request("/api/lanes/sync", { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("syncs on demand once it is on", async () => {
    const { app, put } = build();
    await put({ enabled: true });
    const res = await app.request("/api/lanes/sync", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.status.lastSyncAt).toBeTruthy();
  });
});
