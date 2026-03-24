import type {
  Repository,
  Task,
  TaskWithRun,
  AgentRun,
  AgentLog,
  EngineInfo,
  GitHubRepo,
  DiffSummary,
  CreateRepoRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
  LaunchTaskRequest,
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
    refresh: (id: string) =>
      request<{ ok: boolean }>(`/repos/${id}/refresh`, { method: "POST" }),
    listGitHub: () => request<GitHubRepo[]>("/repos/github/list"),
  },

  tasks: {
    list: (repoId?: string, status?: string) => {
      const params = new URLSearchParams();
      if (repoId) params.set("repo_id", repoId);
      if (status) params.set("status", status);
      const qs = params.toString();
      return request<TaskWithRun[]>(`/tasks${qs ? `?${qs}` : ""}`);
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
    cancel: (id: string) =>
      request<{ ok: boolean }>(`/tasks/${id}/cancel`, { method: "POST" }),
    retry: (id: string) =>
      request<AgentRun>(`/tasks/${id}/retry`, { method: "POST" }),
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
  },

  settings: {
    get: () => request<{ githubToken: string; githubTokenSet: boolean }>("/settings"),
    update: (data: { githubToken?: string }) =>
      request<{ ok: boolean }>("/settings", { method: "PUT", body: JSON.stringify(data) }),
  },
};
