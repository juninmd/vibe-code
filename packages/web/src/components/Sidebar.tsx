import { useState } from "react";
import type { Repository } from "@vibe-code/shared";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

const statusColors: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  pending: "warning",
  cloning: "info",
  ready: "success",
  error: "danger",
};

interface SidebarProps {
  repos: Repository[];
  selectedRepoId: string | null;
  onSelectRepo: (id: string | null) => void;
  onAddRepo: () => void;
  onRemoveRepo: (id: string) => void;
  onOpenSettings: () => void;
  connected: boolean;
}

export function Sidebar({
  repos,
  selectedRepoId,
  onSelectRepo,
  onAddRepo,
  onRemoveRepo,
  onOpenSettings,
  connected,
}: SidebarProps) {
  const [search, setSearch] = useState("");

  const filtered = search
    ? repos.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()) || r.url.toLowerCase().includes(search.toLowerCase()))
    : repos;

  return (
    <aside className="w-64 shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-950">
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-lg font-bold text-zinc-100 flex-1">Vibe Code</h1>
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`}
            title={connected ? "Connected" : "Disconnected"}
          />
          <button
            type="button"
            onClick={onOpenSettings}
            title="Settings"
            className="text-zinc-600 hover:text-zinc-300 transition-colors cursor-pointer"
          >
            ⚙
          </button>
        </div>
        <p className="text-xs text-zinc-500">AI Agent Task Manager</p>
      </div>

      <div className="p-3 flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            Repositories
          </h2>
          <Button size="sm" variant="ghost" onClick={onAddRepo}>
            +
          </Button>
        </div>

        {repos.length > 3 && (
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter repos..."
            className="w-full mb-2 px-2.5 py-1.5 rounded-md border border-zinc-800 bg-zinc-900 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700"
          />
        )}

        <div className="space-y-1 overflow-y-auto flex-1">
          <button
            onClick={() => onSelectRepo(null)}
            className={`w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
              selectedRepoId === null
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
            }`}
          >
            All repositories
          </button>

          {filtered.map((repo) => (
            <div
              key={repo.id}
              className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
                selectedRepoId === repo.id
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
              onClick={() => onSelectRepo(repo.id)}
            >
              <span className="truncate flex-1">{repo.name}</span>
              <Badge variant={statusColors[repo.status] ?? "default"} className="text-[10px]">
                {repo.status}
              </Badge>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveRepo(repo.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-opacity cursor-pointer"
              >
                &#x2715;
              </button>
            </div>
          ))}

          {repos.length === 0 && (
            <p className="text-xs text-zinc-700 px-2.5 py-4 text-center">
              No repositories yet
            </p>
          )}

          {repos.length > 0 && filtered.length === 0 && (
            <p className="text-xs text-zinc-700 px-2.5 py-4 text-center">
              No matches
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
