import { useCurrentWorkspace, useSwitchWorkspace, useWorkspaces } from "@vibe-code/core";
import React from "react";

/**
 * Workspace Selector Component
 * Displays current workspace and allows switching
 */
export function WorkspaceSelector() {
  const { data: workspaces = [], isLoading } = useWorkspaces();
  const { workspaceId } = useCurrentWorkspace();
  const switchWorkspace = useSwitchWorkspace();

  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-gray-700">Workspace:</label>
      <select
        value={workspaceId || ""}
        onChange={(e) => switchWorkspace(e.target.value)}
        disabled={isLoading}
        className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Select workspace"
      >
        {workspaces.length === 0 ? (
          <option value="">No workspaces available</option>
        ) : (
          workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))
        )}
      </select>
      {currentWorkspace && (
        <span className="text-xs text-gray-500">
          {currentWorkspace.description && ` — ${currentWorkspace.description}`}
        </span>
      )}
    </div>
  );
}
