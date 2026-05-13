import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import type { SidecarConfig } from "./sidecar";
import {
  createTask,
  ensureRepo,
  getTaskLogs,
  launchTask,
  listRepos,
  waitReady,
  watchTask,
} from "./sidecar-client";
import type { SidecarDb } from "./sidecar-db";

export interface ToolContext {
  config: SidecarConfig;
  db: SidecarDb;
}

export function buildTools(ctx: ToolContext) {
  const { config, db } = ctx;

  return {
    list_repos: tool({
      description: "List all repositories registered in vibe-code",
      inputSchema: z.object({}),
      execute: async () => {
        const repos = await listRepos(config.serverUrl);
        return repos.map((r) => ({ id: r.id, url: r.url, status: r.status }));
      },
    }),

    get_run_history: tool({
      description: "Get recent task run history for a repository from sidecar memory",
      inputSchema: z.object({
        repo_url: z.string().describe("Repository URL"),
        limit: z.number().int().min(1).max(20).default(5).describe("Number of runs to return"),
      }),
      execute: async ({ repo_url, limit }) => {
        return db.getRecentRuns(repo_url, limit);
      },
    }),

    get_learnings: tool({
      description: "Get accumulated learnings for a repository from previous cycles",
      inputSchema: z.object({
        repo_url: z.string().describe("Repository URL"),
      }),
      execute: async ({ repo_url }) => {
        return db.getLearnings(repo_url);
      },
    }),

    create_and_launch_task: tool({
      description:
        "Import a repository into vibe-code (if needed), create a task with the opencode engine, and launch it. Returns the task_id and run_id.",
      inputSchema: z.object({
        repo_url: z.string().describe("Repository URL to improve"),
        title: z.string().describe("Short task title"),
        description: z.string().describe("Detailed task description / prompt for opencode"),
      }),
      execute: async ({ repo_url, title, description }) => {
        try {
          const repoId = await ensureRepo(config.serverUrl, repo_url);
          await waitReady(config.serverUrl, repoId, 120_000);
          const task = await createTask(config.serverUrl, { repoId, title, description });
          const runId = await launchTask(config.serverUrl, task.id);

          const runRecordId = randomUUID();
          db.insertRun({
            id: runRecordId,
            repo_url,
            task_id: task.id,
            prompt: description,
            status: "launched",
            logs_summary: null,
          });

          return { task_id: task.id, run_id: runId, record_id: runRecordId };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    watch_task: tool({
      description: "Monitor a task via WebSocket until it completes, fails, or times out",
      inputSchema: z.object({
        task_id: z.string().describe("Task ID to monitor"),
        record_id: z.string().optional().describe("Sidecar DB record ID to update on finish"),
        timeout_minutes: z.number().int().min(1).max(120).default(30),
      }),
      execute: async ({ task_id, record_id, timeout_minutes }) => {
        const status = await watchTask(config.serverUrl, task_id, timeout_minutes * 60 * 1000);
        if (record_id) {
          db.updateRun(record_id, { status });
        }
        return { status };
      },
    }),

    get_task_logs: tool({
      description: "Get the last N log lines from a task run",
      inputSchema: z.object({
        run_id: z.string().describe("Run ID (returned by create_and_launch_task)"),
        lines: z.number().int().min(10).max(500).default(100),
      }),
      execute: async ({ run_id, lines }) => {
        try {
          const logs = await getTaskLogs(config.serverUrl, run_id, lines);
          return { logs };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    save_learning: tool({
      description:
        "Save an actionable learning note for a repository to inform future improvement cycles",
      inputSchema: z.object({
        repo_url: z.string().describe("Repository URL"),
        note: z
          .string()
          .describe("What was attempted, what worked or failed, and what to try next"),
      }),
      execute: async ({ repo_url, note }) => {
        db.insertLearning(repo_url, note);
        return { saved: true };
      },
    }),

    finish: tool({
      description: "Signal that the improvement cycle is complete for all repos",
      inputSchema: z.object({
        summary: z.string().describe("Brief summary of what was done this cycle"),
      }),
      execute: async ({ summary }) => {
        return { done: true, summary };
      },
    }),
  };
}
