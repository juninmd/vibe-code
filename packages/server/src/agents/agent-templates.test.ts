import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createAgentTemplatesRouter } from "../api/agent-templates";
import { AgentTemplateRegistry } from "./agent-templates";

describe("AgentTemplateRegistry", () => {
  const reg = new AgentTemplateRegistry();

  it("loads all curated templates", () => {
    expect(reg.size()).toBeGreaterThanOrEqual(25);
  });

  it("templates have required fields", () => {
    for (const t of reg.list()) {
      expect(t.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.instructions.length).toBeGreaterThan(0);
    }
  });

  it("returns known slugs", () => {
    expect(reg.get("bug-fixer")?.name).toBe("Bug Fixer");
    expect(reg.get("code-reviewer")?.category).toBe("Engineering");
    expect(reg.get("does-not-exist")).toBeUndefined();
  });
});

describe("agent-templates router", () => {
  const reg = new AgentTemplateRegistry();
  const app = new Hono().route("/", createAgentTemplatesRouter(reg));

  it("GET / lists templates", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(reg.size());
  });

  it("GET /:slug returns template", async () => {
    const res = await app.request("/bug-fixer");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { slug: string } };
    expect(body.data.slug).toBe("bug-fixer");
  });

  it("GET /:slug returns 404 for unknown", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
  });
});
