import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createDb } from "../db";
import { createReviewsRouter } from "./reviews";

describe("reviews router", () => {
  let db: ReturnType<typeof createDb>;
  let router: ReturnType<typeof createReviewsRouter>;
  let app: Hono;
  let taskId: string;

  beforeEach(() => {
    db = createDb(":memory:");
    router = createReviewsRouter(db);
    app = new Hono();
    app.route("/reviews", router);

    db.workspaces.create({ name: "ws1", slug: "ws1" });
    const ws = db.workspaces.list()[0];
    const repo = db.repos.create({ url: "http://github.com/test/test", workspaceId: ws.id });
    const task = db.tasks.create({
      repoId: repo.id,
      title: "test task",
      status: "in_progress",
    });
    taskId = task.id;
  });

  test("list rounds and issues", async () => {
    // 1. Create a round
    const res1 = await app.request(`/reviews/${taskId}/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundNumber: 1 }),
    });
    expect(res1.status).toBe(201);
    const data1 = await res1.json();
    const roundId = data1.data.round.id;

    // 2. Create an issue
    const res2 = await app.request(`/reviews/${taskId}/rounds/${roundId}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        persona: "test",
        severity: "info",
        title: "test issue",
        content: "test content",
      }),
    });
    expect(res2.status).toBe(201);
    const data2 = await res2.json();
    const issueId = data2.data.issue.id;

    // 3. Update an issue
    const res3 = await app.request(`/reviews/${taskId}/issues/${issueId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "fixed" }),
    });
    expect(res3.status).toBe(200);

    // 4. List issues
    const res4 = await app.request(`/reviews/${taskId}/issues`);
    expect(res4.status).toBe(200);
    const data4 = await res4.json();
    expect(data4.data.issues.length).toBe(1);

    // 5. Delete issue
    const res5 = await app.request(`/reviews/${taskId}/issues/${issueId}`, {
      method: "DELETE",
    });
    expect(res5.status).toBe(200);

    // 6. Delete test: try finding the issue again
    const res6 = await app.request(`/reviews/${taskId}/issues/${issueId}`);
    expect(res6.status).toBe(404);

    // 7. Get specific round
    const res7 = await app.request(`/reviews/${taskId}/rounds/${roundId}`);
    expect(res7.status).toBe(200);

    // 8. List rounds
    const res8 = await app.request(`/reviews/${taskId}/rounds`);
    expect(res8.status).toBe(200);
    const data8 = await res8.json();
    expect(data8.data.rounds.length).toBe(1);

    // 9. List issues for round
    const res9 = await app.request(`/reviews/${taskId}/rounds/${roundId}/issues`);
    expect(res9.status).toBe(200);
  });

  test("error handling", async () => {
    const res1 = await app.request(`/reviews/invalid/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundNumber: 1 }),
    });
    expect(res1.status).toBe(404);

    const res2 = await app.request(`/reviews/${taskId}/rounds/invalid/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        persona: "test",
        severity: "info",
        title: "test issue",
        content: "test content",
      }),
    });
    expect(res2.status).toBe(404);

    const res3 = await app.request(`/reviews/${taskId}/issues/invalid`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "fixed" }),
    });
    expect(res3.status).toBe(404);

    const res4 = await app.request(`/reviews/${taskId}/issues/invalid`, {
      method: "DELETE",
    });
    expect(res4.status).toBe(404);
  });
});
