import type { TaskStatus, TaskWithRun } from "@vibe-code/shared";
import { useMemo, useState } from "react";
import { api } from "../../../api/client";
import { Icon } from "../Icon";
import { ErrorNotice } from "../ManagementViews";
import type { Workspace } from "../WorkspaceViews";
import { BOARD_LANES, groupByLane, planMove } from "./board";
import { SurfaceHeading } from "./SurfaceHeading";

const DOT: Partial<Record<TaskStatus, string>> = {
  in_progress: "working",
  review: "review",
  blocked: "failed",
  failed: "failed",
};

/** Kanban of every task, by pipeline lane. Drag a card, or use its "Mover para" menu. */
export function BoardView({
  workspace,
  onOpen,
}: {
  workspace: Workspace;
  onOpen: (id: string) => void;
}) {
  const tasks = workspace.data.data?.tasks ?? [];
  const lanes = useMemo(() => groupByLane(tasks), [tasks]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const repoName = (task: TaskWithRun) =>
    task.repo?.name ?? workspace.projects.find((p) => p.id === task.repoId)?.name ?? "";

  const move = async (task: TaskWithRun, status: TaskStatus) => {
    const plan = planMove(task, status, lanes);
    if (!plan || busy) return;
    setBusy(task.id);
    setError(null);
    try {
      if (plan.kind === "launch") await api.tasks.launch(task.id);
      else await api.tasks.update(task.id, { status: plan.status, columnOrder: plan.columnOrder });
      await workspace.data.refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  if (!workspace.server)
    return (
      <div className="rw-overview">
        <SurfaceHeading title="Quadro" description="Tarefas por etapa do pipeline." count={0} />
        <div className="rw-empty-view">
          <Icon name="grid" size={26} />
          <h3>Disponível com o servidor</h3>
          <p>Conecte ao servidor em Configurações para ver e mover as tarefas reais.</p>
        </div>
      </div>
    );

  return (
    <div className="rw-overview rw-board-view">
      <SurfaceHeading
        title="Quadro"
        description="Arraste um cartão para outra etapa. Mover para Em execução inicia o agente."
        count={tasks.filter((t) => t.status !== "archived").length}
      />
      <ErrorNotice error={error} />
      <div className="rw-board">
        {BOARD_LANES.map(({ status, label }) => (
          <section
            key={status}
            aria-label={`${label}, ${lanes[status].length} tarefas`}
            className={`rw-lane ${over === status ? "is-over" : ""}`}
            onDragOver={(event) => {
              if (!dragging) return;
              event.preventDefault();
              setOver(status);
            }}
            onDragLeave={() => setOver((current) => (current === status ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              const task = tasks.find((t) => t.id === dragging);
              setDragging(null);
              setOver(null);
              if (task) void move(task, status);
            }}
          >
            <header>
              <span className={`rw-status-dot ${DOT[status] ?? "waiting"}`} />
              <h2>{label}</h2>
              <span className="rw-count">{lanes[status].length}</span>
            </header>
            <div className="rw-lane-cards">
              {lanes[status].map((task) => (
                <article
                  key={task.id}
                  className={`rw-board-card ${busy === task.id ? "is-busy" : ""} ${
                    task.tags?.includes("conflict-resolution") ? "is-conflict" : ""
                  }`}
                  draggable={!busy}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDragging(task.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                >
                  <button type="button" onClick={() => onOpen(task.id)}>
                    <strong>{task.title}</strong>
                    <small>
                      {repoName(task)}
                      {task.engine ? ` · ${task.engine}` : ""}
                    </small>
                  </button>
                  <footer>
                    {task.tags?.includes("conflict-resolution") && (
                      <span className="rw-conflict-badge">Merge conflict</span>
                    )}
                    {task.prUrl && (
                      <a href={task.prUrl} target="_blank" rel="noreferrer">
                        <Icon name="branch" size={12} />
                        PR
                      </a>
                    )}
                    <select
                      aria-label={`Mover "${task.title}" para`}
                      value={task.status}
                      disabled={busy === task.id}
                      onChange={(event) => void move(task, event.target.value as TaskStatus)}
                    >
                      {BOARD_LANES.map((lane) => (
                        <option key={lane.status} value={lane.status}>
                          {lane.label}
                        </option>
                      ))}
                    </select>
                  </footer>
                </article>
              ))}
              {lanes[status].length === 0 && <p className="rw-lane-empty">Sem tarefas</p>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
