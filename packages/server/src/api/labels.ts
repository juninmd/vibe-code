import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db";

const createLabelSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a hex color like #6366f1")
    .default("#6366f1"),
  repoId: z.string().min(1),
});

const updateLabelSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a hex color like #6366f1")
    .optional(),
});

const taskLabelsSchema = z.object({
  labelIds: z.array(z.string()),
});

export function createLabelsRouter(db: Db) {
  const app = new Hono();

  // List labels for a repo
  app.get("/", (c) => {
    const repoId = c.req.query("repoId");
    if (!repoId) return c.json({ error: "repoId query param required" }, 400);
    const labels = db.labels.listByRepo(repoId);
    return c.json(labels);
  });

  // Create a label
  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createLabelSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ error: "Validation error", issues: parsed.error.issues }, 400);

    try {
      const label = db.labels.create(parsed.data);
      return c.json(label, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint")) {
        return c.json({ error: "Label name already exists in this repo" }, 409);
      }
      throw err;
    }
  });

  // Update a label
  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = db.labels.getById(id);
    if (!existing) return c.json({ error: "Label not found" }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = updateLabelSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ error: "Validation error", issues: parsed.error.issues }, 400);

    const name = parsed.data.name ?? existing.name;
    const color = parsed.data.color ?? existing.color;
    const updated = db.labels.update(id, name, color);
    return c.json(updated);
  });

  // Delete a label
  app.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = db.labels.getById(id);
    if (!existing) return c.json({ error: "Label not found" }, 404);
    db.labels.remove(id);
    return c.json({ success: true });
  });

  // Get labels for a task
  app.get("/tasks/:taskId", (c) => {
    const taskId = c.req.param("taskId");
    const labels = db.labels.getTaskLabels(taskId);
    return c.json(labels);
  });

  // Replace all labels for a task
  app.put("/tasks/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    const body = await c.req.json().catch(() => null);
    const parsed = taskLabelsSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ error: "Validation error", issues: parsed.error.issues }, 400);

    db.labels.setTaskLabels(taskId, parsed.data.labelIds);
    const labels = db.labels.getTaskLabels(taskId);
    return c.json(labels);
  });

  // Add a single label to a task
  app.post("/tasks/:taskId/:labelId", (c) => {
    const { taskId, labelId } = c.req.param();
    const label = db.labels.getById(labelId);
    if (!label) return c.json({ error: "Label not found" }, 404);
    db.labels.addTaskLabel(taskId, labelId);
    return c.json({ success: true });
  });

  // Remove a single label from a task
  app.delete("/tasks/:taskId/:labelId", (c) => {
    const { taskId, labelId } = c.req.param();
    db.labels.removeTaskLabel(taskId, labelId);
    return c.json({ success: true });
  });

  return app;
}
