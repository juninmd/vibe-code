import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentRun, Task } from "@vibe-code/shared";
import { useWorkspaceStore } from "../workspace/workspace.store";

/**
 * Query key factory for consistent key management
 */
const queryKeys = {
  all: () => ["resources"] as const,
  tasks: () => [...queryKeys.all(), "tasks"] as const,
  tasksByWorkspace: (wsId: string) => [...queryKeys.tasks(), wsId] as const,
  taskDetail: (id: string) => [...queryKeys.tasks(), id] as const,

  runs: () => [...queryKeys.all(), "runs"] as const,
  runsByWorkspace: (wsId: string) => [...queryKeys.runs(), wsId] as const,
  runDetail: (id: string) => [...queryKeys.runs(), id] as const,

  skills: () => [...queryKeys.all(), "skills"] as const,
  skillsByWorkspace: (wsId: string) => [...queryKeys.skills(), wsId] as const,
  skillDetail: (id: string) => [...queryKeys.skills(), id] as const,

  autopilots: () => [...queryKeys.all(), "autopilots"] as const,
  autopilotsByWorkspace: (wsId: string) => [...queryKeys.autopilots(), wsId] as const,
  autopilotDetail: (id: string) => [...queryKeys.autopilots(), id] as const,
};

/**
 * Fetch all tasks for workspace
 */
export function useTasks(workspaceId: string | null) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.tasksByWorkspace(workspaceId) : ["tasks-null"],
    queryFn: async (): Promise<Task[]> => {
      if (!workspaceId) return [];
      const response = await fetch(`/api/tasks?workspace_id=${workspaceId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch tasks: ${response.statusText}`);
      }
      const data = await response.json();
      console.debug("[Query] Fetched tasks", { count: data.length, workspaceId });
      return data;
    },
    enabled: !!workspaceId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Fetch single task by ID
 */
export function useTask(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.taskDetail(id) : ["task-null"],
    queryFn: async (): Promise<Task> => {
      if (!id) throw new Error("Task ID required");
      const response = await fetch(`/api/tasks/${id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch task: ${response.statusText}`);
      }
      return response.json();
    },
    enabled: !!id,
  });
}

/**
 * Create a new task
 */
export function useCreateTask() {
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s: any) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: async (input: Omit<Task, "id" | "createdAt" | "updatedAt">): Promise<Task> => {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          workspace_id: currentWorkspaceId,
        }),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create task: ${error}`);
      }
      return response.json();
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.tasksByWorkspace(currentWorkspaceId),
        });
      }
    },
  });
}

/**
 * Fetch agent runs for workspace
 */
export function useRuns(workspaceId: string | null) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.runsByWorkspace(workspaceId) : ["runs-null"],
    queryFn: async (): Promise<AgentRun[]> => {
      if (!workspaceId) return [];
      const response = await fetch(`/api/runs?workspace_id=${workspaceId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch runs: ${response.statusText}`);
      }
      const data = await response.json();
      console.debug("[Query] Fetched runs", { count: data.length, workspaceId });
      return data;
    },
    enabled: !!workspaceId,
    staleTime: 10 * 1000, // 10 seconds (more frequent due to live updates)
  });
}

/**
 * Fetch single run by ID
 */
export function useRun(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.runDetail(id) : ["run-null"],
    queryFn: async (): Promise<AgentRun> => {
      if (!id) throw new Error("Run ID required");
      const response = await fetch(`/api/runs/${id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch run: ${response.statusText}`);
      }
      return response.json();
    },
    enabled: !!id,
  });
}

/**
 * Fetch skills for workspace
 */
export function useSkills(workspaceId: string | null) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.skillsByWorkspace(workspaceId) : ["skills-null"],
    queryFn: async (): Promise<any[]> => {
      if (!workspaceId) return [];
      const response = await fetch(`/api/skills?workspace_id=${workspaceId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch skills: ${response.statusText}`);
      }
      const data = await response.json();
      console.debug("[Query] Fetched skills", { count: data.length, workspaceId });
      return data;
    },
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Fetch autopilots for workspace
 */
export function useAutopilots(workspaceId: string | null) {
  return useQuery({
    queryKey: workspaceId ? queryKeys.autopilotsByWorkspace(workspaceId) : ["autopilots-null"],
    queryFn: async (): Promise<any[]> => {
      if (!workspaceId) return [];
      const response = await fetch(`/api/autopilots?workspace_id=${workspaceId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch autopilots: ${response.statusText}`);
      }
      const data = await response.json();
      console.debug("[Query] Fetched autopilots", { count: data.length, workspaceId });
      return data;
    },
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to invalidate all query cache
 * Called when workspace changes or WS events occur
 */
export function useInvalidateAll() {
  const queryClient = useQueryClient();

  return () => {
    console.debug("[Query] Invalidating all cache");
    queryClient.invalidateQueries();
  };
}

/**
 * Hook to invalidate specific resource cache
 */
export function useInvalidateResource(resource: "tasks" | "runs" | "skills" | "autopilots") {
  const queryClient = useQueryClient();

  return () => {
    console.debug(`[Query] Invalidating ${resource} cache`);
    // Invalidate all queries with the resource type in the key
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return Array.isArray(key) && key.includes(resource);
      },
    });
  };
}
