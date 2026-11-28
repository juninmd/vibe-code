import type { AgentRunnerSettings, AgentRunnerStatus } from "@vibe-code/shared";
import { Hono } from "hono";
import { z } from "zod";
import { k8sProblems, RUNNER_SETTINGS_KEY, readRunnerSettings } from "../agents/runners/k8s/config";

interface SettingsStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

// DNS-1123 names (PVC, Secret) and Kubernetes quantities; anything else would only fail at pod creation.
const k8sName = z
  .string()
  .trim()
  .max(253)
  .regex(/^([a-z0-9]([-a-z0-9.]*[a-z0-9])?)?$/, "nome Kubernetes inválido");
const quantity = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?(m|k|M|G|T|Ki|Mi|Gi|Ti)?$/, "quantidade inválida (ex.: 250m, 2, 512Mi)");

const updateSchema = z
  .object({
    runner: z.enum(["local", "k8s"]),
    image: z.string().trim().max(512).regex(/^\S*$/, "imagem sem espaços"),
    pvc: k8sName,
    skillsPvc: k8sName,
    imagePullSecret: k8sName,
    idleMinutes: z
      .number()
      .min(1)
      .max(24 * 60),
    maxLifetimeHours: z.number().min(0.25).max(72),
    startTimeoutSeconds: z.number().int().min(10).max(1800),
    forwardGitHubToken: z.boolean(),
    cpuRequest: quantity,
    cpuLimit: quantity,
    memoryRequest: quantity,
    memoryLimit: quantity,
    ephemeralStorageLimit: quantity,
    maxPodsPerUser: z.number().int().min(1).max(50),
  })
  .partial()
  .strict();

/** Settings → Execução: where agent turns run and how runner pods are sized and reaped. */
export function createRunnerSettingsRouter(
  store: SettingsStore,
  status: () => Omit<AgentRunnerStatus, "settings">,
  env: Record<string, string | undefined> = process.env,
  readNamespace?: () => string | undefined
) {
  const app = new Hono();
  const view = (settings: AgentRunnerSettings): AgentRunnerStatus => ({ ...status(), settings });

  app.get("/", (c) => c.json({ data: view(readRunnerSettings(store, env)) }));

  app.put("/", async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        400
      );
    }
    const next = { ...readRunnerSettings(store, env), ...parsed.data };
    if (next.runner === "k8s") {
      const problems = k8sProblems(next, env, readNamespace);
      if (problems.length > 0)
        return c.json({ error: `Não dá para usar Kubernetes: ${problems.join("; ")}` }, 400);
    }
    store.set(RUNNER_SETTINGS_KEY, JSON.stringify(next));
    return c.json({ data: view(next) });
  });

  return app;
}
