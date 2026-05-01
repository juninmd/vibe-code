import type { Repository, TaskStatus, TaskWithRun } from "@vibe-code/shared";
import { useMemo } from "react";
import { Dialog } from "./ui/dialog";
import { getProviderFromUrl } from "./ui/git-icons";

interface RepoQuickViewProps {
  open: boolean;
  onClose: () => void;
  repos: Repository[];
  tasks: TaskWithRun[];
  onSelectRepo: (repoId: string) => void;
  onOpenRepo: (repo: Repository) => void;
}

interface RepoCardProps {
  repo: Repository;
  tasks: TaskWithRun[];
  onSelect: () => void;
  onOpen: () => void;
}

const STATUS_ORDER: TaskStatus[] = [
  "in_progress",
  "review",
  "backlog",
  "scheduled",
  "done",
  "failed",
];

const STATUS_COLORS: Record<TaskStatus, string> = {
  in_progress: "var(--info)",
  review: "#a855f7",
  backlog: "#71717a",
  scheduled: "var(--warning)",
  done: "var(--success)",
  failed: "var(--danger)",
  archived: "#52525b",
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  in_progress: "Em progresso",
  review: "Em review",
  backlog: "Backlog",
  scheduled: "Agendadas",
  done: "Concluídas",
  failed: "Falhas",
  archived: "Arquivadas",
};

function RepoCard({ repo, tasks, onSelect, onOpen }: RepoCardProps) {
  const prov = getProviderFromUrl(repo.url);
  const ProvIcon = prov.icon;

  const taskCounts = useMemo(() => {
    const counts: Record<TaskStatus, number> = {} as Record<TaskStatus, number>;
    for (const status of STATUS_ORDER) {
      counts[status] = tasks.filter((t) => t.status === status).length;
    }
    return counts;
  }, [tasks]);

  const totalTasks = tasks.length;
  const runningCount = tasks.filter(
    (t) => t.status === "in_progress" && t.latestRun?.status === "running"
  ).length;

  return (
    <div
      className="relative flex flex-col gap-3 p-4 rounded-xl border border-white/[0.06] hover:border-white/[0.12] transition-all group"
      style={{ background: "var(--bg-card)" }}
    >
      <button
        type="button"
        aria-label={`Selecionar ${repo.name}`}
        className="absolute inset-0 z-0 rounded-xl cursor-pointer"
        onClick={onSelect}
      />
      <div className="relative z-10 pointer-events-none flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-secondary">
            <ProvIcon size={16} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {repo.name}
            </h3>
            <p className="text-[10px] truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
              {repo.url.replace(/https?:\/\//, "").replace(/\.git$/, "")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-info/20 text-info">
              <span className="w-1.5 h-1.5 rounded-full bg-info animate-pulse" />
              {runningCount}
            </span>
          )}
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full border"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-muted)",
              background: "var(--bg-input)",
            }}
          >
            {totalTasks}
          </span>
        </div>
      </div>

      {totalTasks > 0 && (
        <div className="relative z-10 pointer-events-none flex flex-wrap gap-1.5">
          {STATUS_ORDER.map((status) => {
            const count = taskCounts[status];
            if (count === 0) return null;
            return (
              <span
                key={status}
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full text-white/80"
                style={{
                  background: `color-mix(in srgb, ${STATUS_COLORS[status]} 25%, transparent)`,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: STATUS_COLORS[status] }}
                />
                {count} {STATUS_LABELS[status]}
              </span>
            );
          })}
        </div>
      )}

      {totalTasks === 0 && (
        <p className="relative z-10 text-[10px]" style={{ color: "var(--text-dimmed)" }}>
          Sem tarefas
        </p>
      )}

      <div className="relative z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="text-[10px] px-2 py-1 rounded-md border border-transparent hover:border-white/[0.1] transition-all cursor-pointer"
          style={{ color: "var(--text-muted)" }}
        >
          Abrir
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="text-[10px] px-2 py-1 rounded-md border border-transparent hover:border-white/[0.1] transition-all cursor-pointer"
          style={{ color: "var(--text-muted)" }}
        >
          Ver Board
        </button>
      </div>
    </div>
  );
}

export function RepoQuickView({
  open,
  onClose,
  repos,
  tasks,
  onSelectRepo,
  onOpenRepo,
}: RepoQuickViewProps) {
  const reposWithTasks = useMemo(() => {
    return repos.map((repo) => ({
      repo,
      tasks: tasks.filter((t) => t.repoId === repo.id),
    }));
  }, [repos, tasks]);

  const totalTaskCount = tasks.length;
  const totalRunning = tasks.filter(
    (t) => t.status === "in_progress" && t.latestRun?.status === "running"
  ).length;
  const totalInReview = tasks.filter((t) => t.status === "review").length;
  const totalDone = tasks.filter((t) => t.status === "done").length;
  const totalFailed = tasks.filter((t) => t.status === "failed").length;

  return (
    <Dialog open={open} onClose={onClose} title="Repositórios" size="xl">
      <div className="space-y-4 -mx-6 -mb-6">
        <div
          className="flex items-center gap-4 px-5 py-3 border-b"
          style={{ borderColor: "var(--glass-border)" }}
        >
          <div className="flex items-center gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
            <span>
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {repos.length}
              </span>{" "}
              repositórios
            </span>
            <span>
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {totalTaskCount}
              </span>{" "}
              tarefas
            </span>
            {totalRunning > 0 && (
              <span className="flex items-center gap-1 text-info">
                <span className="w-1.5 h-1.5 rounded-full bg-info animate-pulse" />
                {totalRunning} em execução
              </span>
            )}
            {totalInReview > 0 && (
              <span style={{ color: "var(--purple-400)" }}>{totalInReview} em review</span>
            )}
            {totalDone > 0 && (
              <span style={{ color: "var(--success)" }}>{totalDone} concluídas</span>
            )}
            {totalFailed > 0 && (
              <span style={{ color: "var(--danger)" }}>{totalFailed} falhas</span>
            )}
          </div>
        </div>

        <div className="px-5 pb-5 overflow-y-auto" style={{ maxHeight: "65vh" }}>
          {reposWithTasks.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-12 text-center gap-2"
              style={{ color: "var(--text-dimmed)" }}
            >
              <p className="text-lg">📂</p>
              <p className="text-sm">Nenhum repositório</p>
              <p className="text-xs">Adicione um repositório para começar</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {reposWithTasks.map(({ repo, tasks: repoTasks }) => (
                <RepoCard
                  key={repo.id}
                  repo={repo}
                  tasks={repoTasks}
                  onSelect={() => {
                    onSelectRepo(repo.id);
                    onClose();
                  }}
                  onOpen={() => {
                    onOpenRepo(repo);
                    onClose();
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
