import { Hono } from "hono";
import { z } from "zod";
import { REACTION_EVENTS_DOC } from "../automation/docs";
import { buildExecutionWaves, validatePlan } from "../automation/plan-validation";
import { DEFAULT_REACTIONS } from "../automation/reactions";

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  order: z.number().int(),
  dependsOn: z.array(z.number().int()).optional(),
  relevantFiles: z.array(z.string()).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  verifyCommand: z.string().optional(),
  doneCriteria: z.string().optional(),
});

export function createAutomationRouter() {
  const app = new Hono();

  /** Static + LLM review of a generated plan, plus parallel execution waves. */
  app.post("/validate-plan", async (c) => {
    const parsed = z
      .object({
        goal: z.string().min(1),
        tasks: z.array(taskSchema).min(1),
        context: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { goal, tasks, context } = parsed.data;
    const result = await validatePlan(goal, tasks, context);
    return c.json({
      ...result,
      waves: buildExecutionWaves(tasks).map((w) => w.map((t) => t.order)),
    });
  });

  app.get("/reactions", (c) =>
    c.json({ defaults: DEFAULT_REACTIONS, events: REACTION_EVENTS_DOC })
  );

  return app;
}
