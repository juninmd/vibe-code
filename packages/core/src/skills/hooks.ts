import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceStore } from "../workspace/workspace.store";
import type { Skill } from "./types";

const skillsQueryKeys = {
  all: () => ["skills"] as const,
  workspace: (wsId: string) => [...skillsQueryKeys.all(), wsId] as const,
  detail: (id: string) => [...skillsQueryKeys.all(), id] as const,
};

/**
 * Fetch all skills for workspace
 */
export function useSkills(workspaceId: string | null) {
  return useQuery({
    queryKey: workspaceId ? skillsQueryKeys.workspace(workspaceId) : ["skills-null"],
    queryFn: async (): Promise<Skill[]> => {
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
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch single skill by ID
 */
export function useSkill(id: string | null) {
  return useQuery({
    queryKey: id ? skillsQueryKeys.detail(id) : ["skill-null"],
    queryFn: async (): Promise<Skill> => {
      if (!id) throw new Error("Skill ID required");
      const response = await fetch(`/api/skills/${id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch skill: ${response.statusText}`);
      }
      return response.json();
    },
    enabled: !!id,
  });
}

/**
 * Create a new skill
 */
export function useCreateSkill() {
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s: any) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: async (
      input: Omit<Skill, "id" | "workspaceId" | "version" | "createdAt" | "updatedAt">
    ): Promise<Skill> => {
      const response = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          workspace_id: currentWorkspaceId,
        }),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create skill: ${error}`);
      }
      return response.json();
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({
          queryKey: skillsQueryKeys.workspace(currentWorkspaceId),
        });
      }
    },
  });
}

/**
 * Update an existing skill
 */
export function useUpdateSkill() {
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s: any) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: async (input: Skill): Promise<Skill> => {
      const response = await fetch(`/api/skills/${input.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to update skill: ${error}`);
      }
      return response.json();
    },
    onSuccess: (skill) => {
      queryClient.invalidateQueries({ queryKey: skillsQueryKeys.detail(skill.id) });
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({
          queryKey: skillsQueryKeys.workspace(currentWorkspaceId),
        });
      }
    },
  });
}

/**
 * Delete a skill
 */
export function useDeleteSkill() {
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s: any) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: async (skillId: string): Promise<void> => {
      const response = await fetch(`/api/skills/${skillId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to delete skill: ${error}`);
      }
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({
          queryKey: skillsQueryKeys.workspace(currentWorkspaceId),
        });
      }
    },
  });
}
