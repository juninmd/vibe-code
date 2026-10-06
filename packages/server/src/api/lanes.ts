import { LANE_STATUSES, MAX_LANE_LABEL_LENGTH } from "@vibe-code/shared";
import { Hono } from "hono";
import { z } from "zod";
import { LaneConfigError, type LaneSyncService } from "../lanes/lane-sync";

const label = z.string().max(MAX_LANE_LABEL_LENGTH).optional();

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  labels: z
    .object(
      Object.fromEntries(LANE_STATUSES.map((lane) => [lane, label])) as Record<
        (typeof LANE_STATUSES)[number],
        typeof label
      >
    )
    .strict()
    .optional(),
});

/** `/api/lanes` — which issue labels drive the board's lanes, and how the sync is doing. */
export function createLanesRouter(lanes: LaneSyncService) {
  const router = new Hono();

  router.get("/", (c) => c.json({ data: lanes.settings() }));

  router.put("/", async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "validation", message: parsed.error.message }, 400);
    }
    try {
      return c.json({ data: lanes.update(parsed.data) });
    } catch (error) {
      if (error instanceof LaneConfigError) {
        return c.json({ error: "validation", message: error.message }, 400);
      }
      throw error;
    }
  });

  // Sync right now instead of waiting for the next poll.
  router.post("/sync", async (c) => {
    if (!lanes.enabled) {
      return c.json({ error: "lanes_disabled", message: "Turn on lane sync first" }, 409);
    }
    await lanes.syncAll();
    return c.json({ data: lanes.settings() });
  });

  return router;
}
