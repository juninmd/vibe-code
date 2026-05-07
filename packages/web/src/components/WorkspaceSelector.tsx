import { useCurrentWorkspace, useSwitchWorkspace, useWorkspaces } from "@vibe-code/core";

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
      <label
        htmlFor="workspace-select"
        className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider"
      >
        Workspace
      </label>
      <select
        id="workspace-select"
        value={workspaceId || ""}
        onChange={(e) => switchWorkspace(e.target.value)}
        disabled={isLoading}
        className="px-2 py-1 border border-transparent hover:border-default rounded-md bg-transparent hover:bg-surface-hover text-primary text-sm font-bold cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent transition-all truncate max-w-[150px] !bg-zinc-900"
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
        <span className="text-xs text-[var(--text-dimmed)] ml-1">
          {currentWorkspace.description && `— ${currentWorkspace.description}`}
        </span>
      )}
    </div>
  );
}
