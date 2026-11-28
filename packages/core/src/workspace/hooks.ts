import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Workspace } from "@vibe-code/shared";
import { useWorkspaceStore } from "./workspace.store";

const WORKSPACE_QUERY_KEY = ["workspaces"] as const;
const workspaceDetailKey = (id: string) => [...WORKSPACE_QUERY_KEY, id] as const;

/**
 * Fetch all workspaces for current user
 */
export function useWorkspaces() {
  return useQuery({
    queryKey: WORKSPACE_QUERY_KEY,
    queryFn: async (): Promise<Workspace[]> => {
      const response = await fetch("/api/workspaces");
      if (!response.ok) {
        throw new Error(`Failed to fetch workspaces: ${response.statusText}`);
      }
      const data = await response.json();
      console.debug("[Query] Fetched workspaces", { count: data.length });
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Fetch specific workspace by ID
 */
export function useWorkspace(id: string | null) {
  return useQuery({
    queryKey: id ? workspaceDetailKey(id) : ["workspace-null"],
    queryFn: async (): Promise<Workspace> => {
      if (!id) throw new Error("Workspace ID required");
      const response = await fetch(`/api/workspaces/${id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch workspace: ${response.statusText}`);
      }
      const data = await response.json();
      console.debug("[Query] Fetched workspace", { id, name: data.name });
      return data;
    },
    enabled: !!id,
  });
}

/**
 * Create a new workspace
 */
export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  const { setError } = useWorkspaceStore();

  return useMutation({
    mutationFn: async (
      input: Omit<Workspace, "id" | "createdAt" | "updatedAt">
    ): Promise<Workspace> => {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create workspace: ${error}`);
      }
      return response.json();
    },
    onSuccess: (workspace) => {
      console.info(`[Workspace] Created workspace "${workspace.name}"`);
      // Invalidate workspace list to refetch
      queryClient.invalidateQueries({ queryKey: WORKSPACE_QUERY_KEY });
      setError(null);
    },
    onError: (error) => {
      console.error("[Workspace] Creation failed", error);
      setError(error instanceof Error ? error.message : "Unknown error");
    },
  });
}

/**
 * Hook to switch current workspace
 * Combines store update + query fetching
 */
export function useSwitchWorkspace() {
  const queryClient = useQueryClient();
  const { setCurrentWorkspaceId, setError } = useWorkspaceStore();

  return (workspaceId: string) => {
    try {
      setCurrentWorkspaceId(workspaceId);
      // Invalidate all queries to refetch for new workspace context
      queryClient.invalidateQueries();
      console.info("[Workspace] Switched and invalidated query cache");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setError(message);
      console.error("[Workspace] Switch failed", error);
    }
  };
}

/**
 * Hook to get current workspace with store integration
 * Returns current workspace from both store and query
 */
export function useCurrentWorkspace() {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspace = useWorkspace(currentWorkspaceId);

  return {
    ...workspace,
    workspaceId: currentWorkspaceId,
  };
}
