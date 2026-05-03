import type {
  AgentLog,
  AgentRun,
  AuthStatus,
  CreatePromptTemplateRequest,
  CreateRepoRequest,
  CreateTaskRequest,
  DiffSummary,
  EngineEffectiveness,
  EngineInfo,
  InboxItem,
  LaunchTaskRequest,
  PromptTemplate,
  RemoteRepo,
  Repository,
  RepositoryIssue,
  RuntimeOverview,
  SettingsResponse,
  SkillEffectiveness,
  SkillsIndex,
  StatsResponse,
  Task,
  TaskArtifact,
  TaskPollResponse,
  TaskSchedule,
  TaskScheduleWithTask,
  TaskWithRun,
  TestConnectionResult,
  UpdateSettingsRequest,
  UpdateTaskRequest,
  UpsertScheduleRequest,
} from "@vibe-code/shared";

const BASE = "/api";

const REQUEST_TIMEOUT_MS = 30_000;

// NOTE: Workspace ID header disabled - API is now public (no authentication)
// function getWorkspaceId(): string | null { ... }

export class ApiError extends Error {
  status: number;
  path: string;
  method: string;

  constructor(message: string, status: number, path: string, method: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
    this.method = method;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const method = options?.method ?? "GET";

  const headers = new Headers(options?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  // NOTE: No longer adding workspace_id header - API is now public

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      credentials: "same-origin",
      signal: options?.signal ?? controller.signal,
      headers,
    });

    const text = await res.text();
    let json: any = null;

    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (!res.ok) {
          throw new ApiError(`Erro ${res.status} em ${method} ${path}`, res.status, path, method);
        }
        throw new ApiError(`Resposta inválida em ${method} ${path}`, res.status, path, method);
      }
    }

    if (!res.ok) {
      const message = json?.message ?? json?.error ?? `Erro ${res.status} em ${method} ${path}`;
      throw new ApiError(message, res.status, path, method);
    }

    return (json?.data ?? null) as T;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new ApiError(
        `Timeout de ${REQUEST_TIMEOUT_MS / 1000}s em ${method} ${path}`,
        408,
        path,
        method
      );
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      (err as Error)?.message || `Falha de rede em ${method} ${path}`,
      0,
      path,
      method
    );
  } finally {
    clearTimeout(timer);
  }
}

// ─── Repositories ────────────────────────────────────────────────────────────

export const api = {
  auth: {
    me: () => request<AuthStatus>("/auth/me"),
    logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
    loginUrl: () => "/api/auth/github/start",
  },

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
    listGitHub: () => request<RemoteRepo[]>("/repos/github/list"),
    searchGitHub: (q: string) =>
      request<RemoteRepo[]>(`/repos/github/search?q=${encodeURIComponent(q)}`),
    createGitHub: (data: { name: string; description: string; isPrivate: boolean }) =>
      request<RemoteRepo>("/repos/github/create", { method: "POST", body: JSON.stringify(data) }),
    listGitLab: () => request<RemoteRepo[]>("/repos/gitlab/list"),
    searchGitLab: (q: string) =>
      request<RemoteRepo[]>(`/repos/gitlab/search?q=${encodeURIComponent(q)}`),
    createGitLab: (data: { name: string; description: string; isPrivate: boolean }) =>
      request<RemoteRepo>("/repos/gitlab/create", { method: "POST", body: JSON.stringify(data) }),
    branches: (id: string) => request<string[]>(`/repos/${id}/branches`),
    skills: (id: string) => request<SkillsIndex>(`/repos/${id}/skills`),
    manifests: (id: string) => request<Record<string, string>>(`/repos/${id}/manifests`),
    issues: (
      id: string,
      options?: { state?: "open" | "closed" | "all"; labels?: string[]; limit?: number }
    ) => {
      const params = new URLSearchParams();
      if (options?.state) params.set("state", options.state);
      if (options?.labels && options.labels.length > 0)
        params.set("labels", options.labels.join(","));
      if (options?.limit) params.set("limit", String(options.limit));
      const qs = params.toString();
      return request<RepositoryIssue[]>(`/repos/${id}/issues${qs ? `?${qs}` : ""}`);
    },
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
    approve: (id: string) => request<{ ok: boolean }>(`/tasks/${id}/approve`, { method: "POST" }),
    reject: (id: string) =>
      request<{ ok: boolean }>(`/tasks/${id}/approve/reject`, { method: "POST" }),
    launch: (id: string, data?: LaunchTaskRequest) =>
      request<AgentRun>(`/tasks/${id}/launch`, {
        method: "POST",
        body: JSON.stringify(data ?? {}),
      }),
    cancel: (id: string) => request<{ ok: boolean }>(`/tasks/${id}/cancel`, { method: "POST" }),
    retry: (id: string, data?: LaunchTaskRequest) =>
      request<AgentRun>(`/tasks/${id}/retry`, {
        method: "POST",
        body: JSON.stringify(data ?? {}),
      }),
    retryPR: (id: string) =>
      request<{ prUrl: string }>(`/tasks/${id}/retry-pr`, { method: "POST" }),
    clone: (id: string) => request<Task>(`/tasks/${id}/clone`, { method: "POST" }),
    runs: (id: string) => request<AgentRun[]>(`/tasks/${id}/runs`),
    artifacts: (id: string) => request<TaskArtifact[]>(`/tasks/${id}/artifacts`),
    diff: (id: string) => request<DiffSummary>(`/tasks/${id}/diff`),
    diffFile: (id: string, path: string) =>
      request<{ patch: string }>(`/tasks/${id}/diff/file?path=${encodeURIComponent(path)}`),
    matchedSkills: (id: string) => request<string[]>(`/tasks/${id}/matched-skills`),
    previewPrompt: (id: string) =>
      request<{ prompt: string }>(`/tasks/${id}/preview-prompt`, { method: "POST" }),
    getMemory: (id: string, scope: "shared" | "task" = "task") =>
      request<{ memory: any; scope: string; needsCompaction: boolean }>(
        `/tasks/${id}/memory?scope=${scope}`
      ),
    updateMemory: (id: string, scope: "shared" | "task", content: string, compactedAt?: string) =>
      request<{ memory: any; needsCompaction: boolean }>(`/tasks/${id}/memory`, {
        method: "PUT",
        body: JSON.stringify({ scope, content, compactedAt }),
      }),
    downloadUrl: (id: string) => `${BASE}/tasks/${id}/download`,
    openEditor: (id: string) =>
      request<{ ok: boolean }>(`/tasks/${id}/open-editor`, { method: "POST" }),
    importFromIssues: (
      repoId: string,
      issues: {
        id: string;
        number: number;
        title: string;
        body: string | null;
        labels: string[];
        url: string;
      }[],
      autoLabel?: string
    ) =>
      request<{ created: { id: string; title: string; number: number }[]; count: number }>(
        "/tasks/bulk/from-issues",
        {
          method: "POST",
          body: JSON.stringify({ repoId, issues, autoLabel }),
        }
      ),
  },

  reviews: {
    listRounds: (taskId: string) => request<{ rounds: any[] }>(`/reviews/${taskId}/rounds`),
    getRound: (taskId: string, roundId: string) =>
      request<{ round: any; issues: any[] }>(`/reviews/${taskId}/rounds/${roundId}`),
    createRound: (taskId: string, roundNumber: number) =>
      request<{ round: any }>(`/reviews/${taskId}/rounds`, {
        method: "POST",
        body: JSON.stringify({ roundNumber }),
      }),
    listIssues: (taskId: string, status?: string) => {
      const qs = status ? `?status=${status}` : "";
      return request<{ issues: any[]; grouped: Record<string, any[]> }>(
        `/reviews/${taskId}/issues${qs}`
      );
    },
    getIssue: (taskId: string, issueId: string) =>
      request<{ issue: any }>(`/reviews/${taskId}/issues/${issueId}`),
    createIssue: (taskId: string, roundId: string, data: any) =>
      request<{ issue: any }>(`/reviews/${taskId}/rounds/${roundId}/issues`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateIssue: (taskId: string, issueId: string, data: any) =>
      request<{ issue: any }>(`/reviews/${taskId}/issues/${issueId}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    deleteIssue: (taskId: string, issueId: string) =>
      request<{ success: boolean }>(`/reviews/${taskId}/issues/${issueId}`, {
        method: "DELETE",
      }),
  },

  runs: {
    logs: (id: string) => request<AgentLog[]>(`/runs/${id}/logs`),
  },

  runtimes: {
    list: () => request<RuntimeOverview[]>("/runtimes"),
  },

  inbox: {
    list: () => request<InboxItem[]>("/inbox"),
  },

  engines: {
    list: () => request<EngineInfo[]>("/engines"),
    models: (name: string) => request<string[]>(`/engines/${name}/models`),
  },

  settings: {
    get: () => request<SettingsResponse>("/settings"),
    update: (data: UpdateSettingsRequest) =>
      request<{ ok: boolean }>("/settings", { method: "PUT", body: JSON.stringify(data) }),
    testConnection: (provider: "github" | "gitlab") =>
      request<TestConnectionResult>(`/settings/test/${provider}`, { method: "POST" }),
    litellmHealth: () => request<{ ok: boolean; baseUrl: string }>("/settings/litellm/health"),
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
    listAll: () => request<TaskScheduleWithTask[]>(`/tasks/schedules`),
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

  stats: {
    get: () => request<StatsResponse>("/stats"),
    skills: () =>
      request<SkillEffectiveness[]>("/stats/skills").then((r) =>
        Array.isArray(r) ? r : ((r as { data: SkillEffectiveness[] }).data ?? [])
      ),
    engines: () =>
      request<EngineEffectiveness[]>("/stats/engines").then((r) =>
        Array.isArray(r) ? r : ((r as { data: EngineEffectiveness[] }).data ?? [])
      ),
  },

  skills: {
    index: () => request<SkillsIndex>("/skills"),
    content: (filePath: string) =>
      request<{ content: string }>(`/skills/content?path=${encodeURIComponent(filePath)}`),
    refresh: () =>
      request<{ skills: number; rules: number; agents: number; workflows: number }>(
        "/skills/refresh",
        { method: "POST" }
      ),
    manifests: () => request<Record<string, string>>("/skills/manifests"),
    registry: {
      list: () => request<string[]>("/skills/registry"),
      install: (repoPath: string) =>
        request<{ name: string; path: string }>("/skills/registry/install", {
          method: "POST",
          body: JSON.stringify({ repoPath }),
        }),
      uninstall: (name: string) =>
        request<{ success: true }>(`/skills/registry/${name}`, { method: "DELETE" }),
    },
  },

  changelog: {
    get: () => request<{ content: string }>("/changelog"),
  },

  templates: {
    list: () => request<string[]>("/templates"),
    export: (name: string) =>
      request<{ ok: boolean; name: string }>("/templates/export", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    import: (name: string, overwrite?: boolean) =>
      request<{ ok: boolean; imported: string }>("/templates/import", {
        method: "POST",
        body: JSON.stringify({ name, overwrite }),
      }),
  },
};
