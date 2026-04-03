import type {
  AgentLog,
  AgentRun,
  CreatePromptTemplateRequest,
  CreateRepoRequest,
  CreateTaskRequest,
  DiffSummary,
  EngineInfo,
  GitHubRepo,
  LaunchTaskRequest,
  PromptTemplate,
  Repository,
  Task,
  TaskPollResponse,
  TaskSchedule,
  TaskWithRun,
  UpdateTaskRequest,
  UpsertScheduleRequest,
} from "@vibe-code/shared";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? json.error ?? "Request failed");
  return json.data;
}

// ─── Repositories ────────────────────────────────────────────────────────────

export const api = {
  repos: {
    list: () => request<Repository[]>("/repos"),
    get: (id: string) => request<Repository>(`/repos/${id}`),
    create: (data: CreateRepoRequest) =>
      request<Repository>("/repos", { method: "POST", body: JSON.stringify(data) }),
    remove: (id: string) => request<{ ok: boolean }>(`/repos/${id}`, { method: "DELETE" }),
    deleteLocalClone: (id: string) =>
      request<Repository>(`/repos/${id}/local-clone`, { method: "DELETE" }),
    purgeLocalClones: () =>
      request<{ deleted: number; skipped: number }>(`/repos/local-clones/purge`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      }),
    refresh: (id: string) => request<{ ok: boolean }>(`/repos/${id}/refresh`, { method: "POST" }),
    listGitHub: () => request<GitHubRepo[]>("/repos/github/list"),
    createGitHub: (data: { name: string; description: string; isPrivate: boolean }) =>
      request<GitHubRepo>("/repos/github/create", { method: "POST", body: JSON.stringify(data) }),
    branches: (id: string) => request<string[]>(`/repos/${id}/branches`),
  },

  tasks: {
    list: (repoId?: string, status?: string) => {
      const params = new URLSearchParams();
      if (repoId) params.set("repo_id", repoId);
      if (status) params.set("status", status);
      const qs = params.toString();
      return request<TaskWithRun[]>(`/tasks${qs ? `?${qs}` : ""}`);
    },
    poll: (repoId?: string, focusedTaskId?: string, focusedLogsAfterId?: number) => {
      const params = new URLSearchParams();
      if (repoId) params.set("repo_id", repoId);
      if (focusedTaskId) params.set("focused_task_id", focusedTaskId);
      if (focusedLogsAfterId && focusedLogsAfterId > 0) {
        params.set("focused_logs_after_id", String(focusedLogsAfterId));
      }
      const qs = params.toString();
      return request<TaskPollResponse>(`/tasks/poll${qs ? `?${qs}` : ""}`);
    },
    archiveDone: (repoId?: string) => {
      const qs = repoId ? `?repo_id=${repoId}` : "";
      return request<{ archived: number }>(`/tasks/archive-done${qs}`, { method: "POST" });
    },
    clearFailed: (repoId?: string) => {
      const qs = repoId ? `?repo_id=${repoId}` : "";
      return request<{ deleted: number }>(`/tasks/clear-failed${qs}`, { method: "POST" });
    },
    retryFailed: (repoId?: string) => {
      const qs = repoId ? `?repo_id=${repoId}` : "";
      return request<{ retried: number }>(`/tasks/retry-failed${qs}`, { method: "POST" });
    },
    get: (id: string) => request<TaskWithRun>(`/tasks/${id}`),
    create: (data: CreateTaskRequest) =>
      request<Task>("/tasks", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: UpdateTaskRequest) =>
      request<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) => request<{ ok: boolean }>(`/tasks/${id}`, { method: "DELETE" }),
    launch: (id: string, data?: LaunchTaskRequest) =>
      request<AgentRun>(`/tasks/${id}/launch`, {
        method: "POST",
        body: JSON.stringify(data ?? {}),
      }),
    cancel: (id: string) => request<{ ok: boolean }>(`/tasks/${id}/cancel`, { method: "POST" }),
    retry: (id: string) => request<AgentRun>(`/tasks/${id}/retry`, { method: "POST" }),
    retryPR: (id: string) =>
      request<{ prUrl: string }>(`/tasks/${id}/retry-pr`, { method: "POST" }),
    runs: (id: string) => request<AgentRun[]>(`/tasks/${id}/runs`),
    diff: (id: string) => request<DiffSummary>(`/tasks/${id}/diff`),
    diffFile: (id: string, path: string) =>
      request<{ patch: string }>(`/tasks/${id}/diff/file?path=${encodeURIComponent(path)}`),
  },

  runs: {
    logs: (id: string) => request<AgentLog[]>(`/runs/${id}/logs`),
  },

  engines: {
    list: () => request<EngineInfo[]>("/engines"),
    models: (name: string) => request<string[]>(`/engines/${name}/models`),
  },

  settings: {
    get: () => request<{ githubToken: string; githubTokenSet: boolean }>("/settings"),
    update: (data: { githubToken?: string }) =>
      request<{ ok: boolean }>("/settings", { method: "PUT", body: JSON.stringify(data) }),
  },

  prompts: {
    list: () => request<PromptTemplate[]>("/prompts"),
    create: (data: CreatePromptTemplateRequest) =>
      request<PromptTemplate>("/prompts", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<CreatePromptTemplateRequest>) =>
      request<PromptTemplate>(`/prompts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) => request<{ ok: boolean }>(`/prompts/${id}`, { method: "DELETE" }),
  },

  schedules: {
    get: (taskId: string) => request<TaskSchedule | null>(`/tasks/${taskId}/schedule`),
    upsert: (taskId: string, data: UpsertScheduleRequest) =>
      request<TaskSchedule>(`/tasks/${taskId}/schedule`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    remove: (taskId: string) =>
      request<{ ok: boolean }>(`/tasks/${taskId}/schedule`, { method: "DELETE" }),
    toggle: (taskId: string, enabled: boolean) =>
      request<TaskSchedule>(`/tasks/${taskId}/schedule/toggle`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      }),
    runNow: (taskId: string) =>
      request<AgentRun>(`/tasks/${taskId}/schedule/run-now`, { method: "POST" }),
  },
};
