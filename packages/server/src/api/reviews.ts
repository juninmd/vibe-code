import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";
import type { ReviewIssue } from "../db/queries";

const createReviewRoundSchema = z.object({
  roundNumber: z.number().int().positive(),
});

const createReviewIssueSchema = z.object({
  persona: z.string().min(1),
  severity: z.enum(["info", "warning", "blocker"]),
  title: z.string().min(1),
  content: z.string(),
  filePath: z.string().optional().nullable(),
});

const updateReviewIssueSchema = z.object({
  status: z.enum(["open", "valid", "invalid", "fixed", "resolved"]).optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  severity: z.enum(["info", "warning", "blocker"]).optional(),
});

export function createReviewsRouter(db: Db) {
  const router = new Hono();

  // ── List review rounds for a task ──────────────────────────────────────────
  router.get("/:taskId/rounds", (c) => {
    const taskId = c.req.param("taskId");
    const task = db.tasks.getById(taskId);
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);

    const rounds = db.reviewRounds.listByTaskId(taskId);
    return c.json({ data: { rounds } });
  });

  // ── Get a specific review round ────────────────────────────────────────────
  router.get("/:taskId/rounds/:roundId", (c) => {
    const taskId = c.req.param("taskId");
    const roundId = c.req.param("roundId");

    const round = db.reviewRounds.getById(roundId);
    if (!round || round.taskId !== taskId) {
      return c.json({ error: "not_found", message: "Review round not found" }, 404);
    }

    const issues = db.reviewIssues.listByRoundId(roundId);
    return c.json({ data: { round, issues } });
  });

  // ── Create a new review round ─────────────────────────────────────────────
  router.post("/:taskId/rounds", async (c) => {
    const taskId = c.req.param("taskId");
    const task = db.tasks.getById(taskId);
    if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404);

    const body = await c.req.json();
    const parsed = createReviewRoundSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }

    const round = db.reviewRounds.create({
      taskId,
      roundNumber: parsed.data.roundNumber,
    });

    return c.json({ data: { round } }, 201);
  });

  // ── List review issues for a round ────────────────────────────────────────
  router.get("/:taskId/rounds/:roundId/issues", (c) => {
    const roundId = c.req.param("roundId");
    const round = db.reviewRounds.getById(roundId);
    if (!round) return c.json({ error: "not_found", message: "Review round not found" }, 404);

    const issues = db.reviewIssues.listByRoundId(roundId);
    return c.json({ data: { issues } });
  });

  // ── Create a review issue ────────────────────────────────────────────────
  router.post("/:taskId/rounds/:roundId/issues", async (c) => {
    const taskId = c.req.param("taskId");
    const roundId = c.req.param("roundId");

    const round = db.reviewRounds.getById(roundId);
    if (!round || round.taskId !== taskId) {
      return c.json({ error: "not_found", message: "Review round not found" }, 404);
    }

    const body = await c.req.json();
    const parsed = createReviewIssueSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }

    const issue = db.reviewIssues.create({
      roundId,
      taskId,
      persona: parsed.data.persona,
      severity: parsed.data.severity,
      title: parsed.data.title,
      content: parsed.data.content,
      filePath: parsed.data.filePath,
    });

    return c.json({ data: { issue } }, 201);
  });

  // ── Get a specific review issue ──────────────────────────────────────────
  router.get("/:taskId/issues/:issueId", (c) => {
    const taskId = c.req.param("taskId");
    const issueId = c.req.param("issueId");

    const issue = db.reviewIssues.getById(issueId);
    if (!issue || issue.taskId !== taskId) {
      return c.json({ error: "not_found", message: "Review issue not found" }, 404);
    }

    return c.json({ data: { issue } });
  });

  // ── Update a review issue ────────────────────────────────────────────────
  router.put("/:taskId/issues/:issueId", async (c) => {
    const taskId = c.req.param("taskId");
    const issueId = c.req.param("issueId");

    const issue = db.reviewIssues.getById(issueId);
    if (!issue || issue.taskId !== taskId) {
      return c.json({ error: "not_found", message: "Review issue not found" }, 404);
    }

    const body = await c.req.json();
    const parsed = updateReviewIssueSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }

    const updated = db.reviewIssues.update(issueId, parsed.data);
    if (!updated) {
      return c.json({ error: "update_failed", message: "Failed to update issue" }, 500);
    }

    return c.json({ data: { issue: updated } });
  });

  // ── Delete a review issue ────────────────────────────────────────────────
  router.delete("/:taskId/issues/:issueId", (c) => {
    const taskId = c.req.param("taskId");
    const issueId = c.req.param("issueId");

    const issue = db.reviewIssues.getById(issueId);
    if (!issue || issue.taskId !== taskId) {
      return c.json({ error: "not_found", message: "Review issue not found" }, 404);
    }

    db.reviewIssues.remove(issueId);
    return c.json({ data: { success: true } });
  });

  // ── List all review issues for a task (grouped by round) ──────────────────
  router.get("/:taskId/issues", (c) => {
    const taskId = c.req.param("taskId");
    const statusParam = c.req.query("status");

    const issues = db.reviewIssues.listByTaskId(taskId, statusParam);
    const grouped = new Map<string, ReviewIssue[]>();

    for (const issue of issues) {
      if (!grouped.has(issue.roundId)) {
        grouped.set(issue.roundId, []);
      }
      grouped.get(issue.roundId)?.push(issue);
    }

    return c.json({ data: { issues, grouped: Object.fromEntries(grouped) } });
  });

  return router;
}
