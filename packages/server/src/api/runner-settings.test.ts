import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createRunnerSettingsRouter } from "./runner-settings";

function app(env: Record<string, string> = {}) {
  const rows = new Map<string, string>();
  const store = {
    get: (k: string) => rows.get(k) ?? null,
    set: (k: string, v: string) => void rows.set(k, v),
  };
  const status = () => ({ inCluster: !!env.KUBERNETES_SERVICE_HOST, activePods: 0 });
  const hono = new Hono().route(
    "/r",
    createRunnerSettingsRouter(store, status, env, () => "ns")
  );
  const put = (body: unknown) =>
    hono.request("/r", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  return { hono, put, rows };
}

describe("runner settings API", () => {
  it("defaults to local and persists a change for the next GET", async () => {
    const { hono, put } = app();
    expect((await (await hono.request("/r")).json()).data.settings.runner).toBe("local");
    expect((await put({ idleMinutes: 30 })).status).toBe(200);
    expect((await (await hono.request("/r")).json()).data.settings.idleMinutes).toBe(30);
  });

  it("refuses k8s outside a cluster or without image/PVC, and keeps the old value", async () => {
    const { hono, put } = app();
    const res = await put({ runner: "k8s" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("cluster");
    expect((await (await hono.request("/r")).json()).data.settings.runner).toBe("local");
  });

  it("accepts k8s in a cluster once image and PVC are set", async () => {
    const { put } = app({ KUBERNETES_SERVICE_HOST: "10.0.0.1" });
    expect((await put({ runner: "k8s" })).status).toBe(400);
    const ok = await put({ runner: "k8s", image: "ghcr.io/x/y:1", pvc: "data" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.settings.runner).toBe("k8s");
  });

  it("rejects values that would only fail at pod creation, and unknown fields", async () => {
    const { put } = app();
    expect((await put({ pvc: "Bad_Name" })).status).toBe(400);
    expect((await put({ memoryLimit: "4 gigs" })).status).toBe(400);
    expect((await put({ idleMinutes: 0 })).status).toBe(400);
    expect((await put({ nodeName: "x" })).status).toBe(400);
  });
});
