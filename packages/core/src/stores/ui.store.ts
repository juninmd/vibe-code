import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface UIState {
  // UI visibility states (non-persisted)
  showNewTaskDialog: boolean;
  showAddRepoDialog: boolean;
  showSettingsDialog: boolean;
  showSkillsDialog: boolean;
  showEnginesPanel: boolean;
  showStatsDialog: boolean;
  showShortcutsModal: boolean;

  // Filter states (persisted)
  selectedAgent: string | null;
  selectedRepoId: string | null;
  taskFilters: {
    engine?: string;
    priority?: number | null;
    hasPR?: boolean;
    status?: string;
  };

  // Selected task/run for detail view
  selectedTaskId: string | null;

  // Actions
  setShowNewTaskDialog: (show: boolean) => void;
  setShowAddRepoDialog: (show: boolean) => void;
  setShowSettingsDialog: (show: boolean) => void;
  setShowSkillsDialog: (show: boolean) => void;
  setShowEnginesPanel: (show: boolean) => void;
  setShowStatsDialog: (show: boolean) => void;
  setShowShortcutsModal: (show: boolean) => void;

  setSelectedAgent: (agent: string | null) => void;
  setSelectedRepoId: (id: string | null) => void;
  setTaskFilters: (filters: UIState["taskFilters"]) => void;
  setSelectedTaskId: (id: string | null) => void;

  // Bulk hide modals
  hideAllModals: () => void;
}

/**
 * UI store — manages client-side UI state only
 * Filters and selections are persisted to localStorage
 * Modal visibility is ephemeral
 */
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Initial UI state
      showNewTaskDialog: false,
      showAddRepoDialog: false,
      showSettingsDialog: false,
      showSkillsDialog: false,
      showEnginesPanel: false,
      showStatsDialog: false,
      showShortcutsModal: false,

      selectedAgent: null,
      selectedRepoId: null,
      taskFilters: {},
      selectedTaskId: null,

      // Actions
      setShowNewTaskDialog: (show: boolean) => set({ showNewTaskDialog: show }),
      setShowAddRepoDialog: (show: boolean) => set({ showAddRepoDialog: show }),
      setShowSettingsDialog: (show: boolean) => set({ showSettingsDialog: show }),
      setShowSkillsDialog: (show: boolean) => set({ showSkillsDialog: show }),
      setShowEnginesPanel: (show: boolean) => set({ showEnginesPanel: show }),
      setShowStatsDialog: (show: boolean) => set({ showStatsDialog: show }),
      setShowShortcutsModal: (show: boolean) => set({ showShortcutsModal: show }),

      setSelectedAgent: (agent: string | null) => set({ selectedAgent: agent }),
      setSelectedRepoId: (id: string | null) => set({ selectedRepoId: id }),
      setTaskFilters: (filters: UIState["taskFilters"]) => set({ taskFilters: filters }),
      setSelectedTaskId: (id: string | null) => set({ selectedTaskId: id }),

      hideAllModals: () =>
        set({
          showNewTaskDialog: false,
          showAddRepoDialog: false,
          showSettingsDialog: false,
          showSkillsDialog: false,
          showEnginesPanel: false,
          showStatsDialog: false,
          showShortcutsModal: false,
        }),
    }),
    {
      name: "ui-store",
      partialize: (state) => ({
        selectedAgent: state.selectedAgent,
        selectedRepoId: state.selectedRepoId,
        taskFilters: state.taskFilters,
      }),
    }
  )
);
