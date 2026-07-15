import { expect, test } from "@playwright/test";
import { E2E } from "../playwright.config";

/**
 * API smoke suite: proves the server boots, core endpoints respond, and the
 * repo → task lifecycle works against a real local git fixture.
 */

const api = (path: string) => `${E2E.serverUrl}${path}`;

test.describe("API smoke", () => {
  test("health endpoint responds", async ({ request }) => {
    const res = await request.get(api("/api/health"));
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("auth is disabled for the e2e environment", async ({ request }) => {
    const res = await request.get(api("/api/auth/me"));
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.enabled).toBe(false);
    expect(body.data.authenticated).toBe(true);
  });

  test("engines endpoint lists registered engines including opencode", async ({ request }) => {
    const res = await request.get(api("/api/engines"));
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    const names = body.data.map((e: { name: string }) => e.name);
    expect(names).toContain("opencode");
  });

  test("repo and task lifecycle", async ({ request }) => {
    // Register the local fixture repo
    const createRepo = await request.post(api("/api/repos"), {
      data: { url: E2E.fixtureRepo },
    });
    expect(createRepo.status()).toBe(201);
    const repo = (await createRepo.json()).data;

    // Wait for the background bare-clone to finish
    await expect
      .poll(
        async () => {
          const res = await request.get(api("/api/repos"));
          const repos = (await res.json()).data as Array<{ id: string; status: string }>;
          return repos.find((r) => r.id === repo.id)?.status;
        },
        { timeout: 30_000 }
      )
      .toBe("ready");

    // Validation: missing title is rejected
    const invalid = await request.post(api("/api/tasks"), {
      data: { repoId: repo.id },
    });
    expect(invalid.status()).toBe(400);

    // Validation: unknown repo is rejected
    const orphan = await request.post(api("/api/tasks"), {
      data: { title: "orphan", repoId: "does-not-exist" },
    });
    expect(orphan.status()).toBe(404);

    // Create a real task with the fields the modal sends
    const createTask = await request.post(api("/api/tasks"), {
      data: {
        title: "e2e: smoke task",
        description: "created by api-smoke.spec.ts",
        repoId: repo.id,
        engine: "opencode",
        priority: "high",
        tags: ["e2e"],
        baseBranch: "main",
      },
    });
    expect(createTask.status()).toBe(201);
    const task = (await createTask.json()).data;
    expect(task.status).toBe("backlog");
    expect(task.engine).toBe("opencode");
    expect(task.priority).toBe("high");
    expect(task.tags).toEqual(["e2e"]);
    expect(task.baseBranch).toBe("main");

    // Task shows up in the list with its latest-run/usage envelope
    const list = await request.get(api(`/api/tasks?repo_id=${repo.id}`));
    const tasks = (await list.json()).data as Array<{ id: string; usageSummary?: unknown }>;
    const found = tasks.find((t) => t.id === task.id);
    expect(found).toBeTruthy();
    expect(found?.usageSummary).toBeTruthy();

    // Update flows used by the task detail modal
    const patch = await request.patch(api(`/api/tasks/${task.id}`), {
      data: { notes: "note from e2e", tags: ["e2e", "patched"], priority: "urgent" },
    });
    expect(patch.status()).toBe(200);
    const patched = (await patch.json()).data;
    expect(patched.notes).toBe("note from e2e");
    expect(patched.tags).toEqual(["e2e", "patched"]);
    expect(patched.priority).toBe("urgent");

    // Launch guard: tasks not in a launchable state are rejected
    await request.patch(api(`/api/tasks/${task.id}`), { data: { status: "done" } });
    const launchDone = await request.post(api(`/api/tasks/${task.id}/launch`), { data: {} });
    expect(launchDone.status()).toBe(400);
    await request.patch(api(`/api/tasks/${task.id}`), { data: { status: "backlog" } });

    // Delete
    const del = await request.delete(api(`/api/tasks/${task.id}`));
    expect(del.status()).toBe(200);
    const after = await request.get(api(`/api/tasks/${task.id}`));
    expect(after.status()).toBe(404);
  });
});
