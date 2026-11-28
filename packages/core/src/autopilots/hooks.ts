import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceStore } from "../workspace/workspace.store";
import type { Autopilot } from "./types";

const autopilotsQueryKeys = {
  all: () => ["autopilots"] as const,
  workspace: (wsId: string) => [...autopilotsQueryKeys.all(), wsId] as const,
  detail: (id: string) => [...autopilotsQueryKeys.all(), id] as const,
};

/**
 * Fetch all autopilots for workspace
 */
export function useAutopilots(workspaceId: string | null) {
  return useQuery({
    queryKey: workspaceId ? autopilotsQueryKeys.workspace(workspaceId) : ["autopilots-null"],
    queryFn: async (): Promise<Autopilot[]> => {
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
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch single autopilot by ID
 */
export function useAutopilot(id: string | null) {
  return useQuery({
    queryKey: id ? autopilotsQueryKeys.detail(id) : ["autopilot-null"],
    queryFn: async (): Promise<Autopilot> => {
      if (!id) throw new Error("Autopilot ID required");
      const response = await fetch(`/api/autopilots/${id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch autopilot: ${response.statusText}`);
      }
      return response.json();
    },
    enabled: !!id,
  });
}

/**
 * Create a new autopilot
 */
export function useCreateAutopilot() {
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s: any) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: async (
      input: Omit<Autopilot, "id" | "workspaceId" | "version" | "createdAt" | "updatedAt">
    ): Promise<Autopilot> => {
      const response = await fetch("/api/autopilots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          workspace_id: currentWorkspaceId,
        }),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create autopilot: ${error}`);
      }
      return response.json();
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({
          queryKey: autopilotsQueryKeys.workspace(currentWorkspaceId),
        });
      }
    },
  });
}

/**
 * Update an existing autopilot
 */
export function useUpdateAutopilot() {
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s: any) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: async (input: Autopilot): Promise<Autopilot> => {
      const response = await fetch(`/api/autopilots/${input.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to update autopilot: ${error}`);
      }
      return response.json();
    },
    onSuccess: (autopilot) => {
      queryClient.invalidateQueries({ queryKey: autopilotsQueryKeys.detail(autopilot.id) });
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({
          queryKey: autopilotsQueryKeys.workspace(currentWorkspaceId),
        });
      }
    },
  });
}

/**
 * Delete an autopilot
 */
export function useDeleteAutopilot() {
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s: any) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: async (autopilotId: string): Promise<void> => {
      const response = await fetch(`/api/autopilots/${autopilotId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to delete autopilot: ${error}`);
      }
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({
          queryKey: autopilotsQueryKeys.workspace(currentWorkspaceId),
        });
      }
    },
  });
}

/**
 * Trigger an autopilot execution
 */
export function useTriggerAutopilot() {
  return useMutation({
    mutationFn: async (autopilotId: string): Promise<{ runId: string }> => {
      const response = await fetch(`/api/autopilots/${autopilotId}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to trigger autopilot: ${error}`);
      }
      return response.json();
    },
  });
}
