import type { Workspace } from "@vibe-code/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WorkspaceState {
  // Data
  workspaces: Workspace[];
  currentWorkspaceId: string | null;

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  setWorkspaces: (workspaces: Workspace[]) => void;
  setCurrentWorkspaceId: (id: string) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Computed
  currentWorkspace: () => Workspace | undefined;
}

/**
 * Workspace store — manages current workspace selection and list
 * Persists workspace preference to localStorage
 */
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      // State
      workspaces: [],
      currentWorkspaceId: null,
      isLoading: false,
      error: null,

      // Actions
      setWorkspaces: (workspaces: Workspace[]) => {
        set({ workspaces });
        // If no current workspace selected and have workspaces, select first
        const { currentWorkspaceId } = get();
        if (!currentWorkspaceId && workspaces.length > 0) {
          set({ currentWorkspaceId: workspaces[0].id });
        }
      },

      setCurrentWorkspaceId: (id: string) => {
        const { workspaces } = get();
        const workspace = workspaces.find((w) => w.id === id);
        if (!workspace) {
          set({ error: `Workspace ${id} not found` });
          return;
        }
        set({ currentWorkspaceId: id, error: null });
        console.info(`[Workspace] Switched to workspace ${id} (${workspace.name})`);
      },

      setIsLoading: (loading: boolean) => set({ isLoading: loading }),
      setError: (error: string | null) => set({ error }),

      // Computed
      currentWorkspace: () => {
        const { currentWorkspaceId, workspaces } = get();
        return workspaces.find((w) => w.id === currentWorkspaceId);
      },
    }),
    {
      name: "workspace-store",
      partialize: (state) => ({
        currentWorkspaceId: state.currentWorkspaceId,
      }),
    }
  )
);
