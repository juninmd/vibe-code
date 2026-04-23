import { useCallback, useState } from "react";
import { useScheduledTasks } from "../hooks/useScheduledTasks";
import { useTaskRuns } from "../hooks/useTaskRuns";

export function ScheduledTasksPanel() {
  const { tasks, loading, error, refetch } = useScheduledTasks();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingCron, setEditingCron] = useState<string>("");
  const [cronError, setCronError] = useState<string | null>(null);
  const [isSubmittingCron, setIsSubmittingCron] = useState(false);
  const [isExecutingTask, setIsExecutingTask] = useState<string | null>(null);
  const [isTogglingTask, setIsTogglingTask] = useState<string | null>(null);

  const { runs: selectedTaskRuns, fetch: fetchTaskRuns } = useTaskRuns(selectedTaskId);

  const handleViewRuns = useCallback(
    (taskId: string) => {
      setSelectedTaskId(taskId);
      fetchTaskRuns();
    },
    [fetchTaskRuns]
  );

  const handleRunNow = useCallback(
    async (taskId: string) => {
      setIsExecutingTask(taskId);
      try {
        console.info(`🚀 Executing task ${taskId} immediately`);

        const response = await fetch(`/api/tasks/${taskId}/schedule/run-now`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.message || `HTTP ${response.status}`);
        }

        console.info(`✅ Run triggered for task ${taskId}`);
        refetch();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ Failed to run task ${taskId}:`, msg);
      } finally {
        setIsExecutingTask(null);
      }
    },
    [refetch]
  );

  const handleToggleSchedule = useCallback(
    async (taskId: string, currentEnabled: boolean) => {
      setIsTogglingTask(taskId);
      try {
        const newState = !currentEnabled;
        console.debug(`🔀 Toggling schedule ${taskId} to ${newState}`);

        const response = await fetch(`/api/tasks/${taskId}/schedule/toggle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: newState }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.message || `HTTP ${response.status}`);
        }

        console.info(`✅ Schedule toggled for task ${taskId} to ${newState}`);
        refetch();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ Failed to toggle schedule ${taskId}:`, msg);
      } finally {
        setIsTogglingTask(null);
      }
    },
    [refetch]
  );

  const handleEditCron = useCallback((taskId: string, currentCron: string) => {
    setEditingTaskId(taskId);
    setEditingCron(currentCron);
    setCronError(null);
  }, []);

  const handleSaveCron = useCallback(
    async (taskId: string) => {
      setIsSubmittingCron(true);
      setCronError(null);

      try {
        console.debug(`✏️ Validating cron expression: ${editingCron}`);

        const response = await fetch(`/api/tasks/${taskId}/schedule`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cronExpression: editingCron }),
        });

        if (!response.ok) {
          const data = await response.json();
          const errorMsg = data.message || `HTTP ${response.status}`;
          console.warn(`⚠️ Invalid cron: ${errorMsg}`);
          setCronError(errorMsg);
          return;
        }

        console.info(`✅ Cron expression updated for task ${taskId}`);
        setEditingTaskId(null);
        refetch();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ Failed to update cron for task ${taskId}:`, msg);
        setCronError(msg);
      } finally {
        setIsSubmittingCron(false);
      }
    },
    [editingCron, refetch]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingTaskId(null);
    setEditingCron("");
    setCronError(null);
  }, []);

  const enabledCount = tasks.filter((t) => t.schedule.enabled).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-primary">Tarefas Agendadas</h3>
          <p className="text-xs text-primary0 mt-0.5">
            {loading ? (
              <span className="animate-pulse">Carregando...</span>
            ) : (
              <>
                {enabledCount}/{tasks.length} ativas
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={loading}
          className="p-1.5 rounded-lg text-primary0 hover:text-secondary hover:bg-surface-hover cursor-pointer transition-colors text-sm disabled:opacity-40"
          title="Atualizar"
        >
          <span className={loading ? "inline-block animate-spin" : ""}>↻</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {error && (
          <div className="bg-danger/15 border border-danger/30 text-danger p-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-dimmed text-4xl mb-2">📋</div>
            <h4 className="text-sm font-medium text-secondary">Sem agendamentos</h4>
            <p className="text-xs text-primary0 mt-1">Nenhuma tarefa agendada no momento.</p>
          </div>
        ) : (
          tasks.map(({ schedule, task }) => (
            <div
              key={schedule.id}
              className={`rounded-lg border p-3 transition-all duration-200 ${
                schedule.enabled
                  ? "bg-input border-strong/50"
                  : "bg-input/50 border-default opacity-70"
              }`}
            >
              <div className="space-y-2">
                {/* Task title + status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-primary truncate">{task.title}</h4>
                    <p className="text-xs text-primary0 truncate">{task.description}</p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                      schedule.enabled
                        ? "bg-success/15 text-success border border-success/30"
                        : "bg-surface text-primary0 border border-strong/40"
                    }`}
                  >
                    <span
                      className={`w-1 h-1 rounded-full ${
                        schedule.enabled ? "bg-emerald-400 animate-pulse" : "bg-border-strong"
                      }`}
                    />
                    {schedule.enabled ? "ativo" : "inativo"}
                  </span>
                </div>

                {/* Cron info */}
                {editingTaskId === schedule.id ? (
                  <div className="space-y-2">
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={editingCron}
                        onChange={(e) => setEditingCron(e.target.value)}
                        placeholder="Cron expression (e.g., 0 9 * * MON)"
                        className="text-xs px-2 py-1 rounded border border-strong bg-surface text-primary flex-1 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    {cronError && (
                      <p className="text-xs text-danger bg-danger/15 px-2 py-1 rounded">
                        {cronError}
                      </p>
                    )}
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => handleSaveCron(schedule.id)}
                        disabled={isSubmittingCron || !editingCron.trim()}
                        className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {isSubmittingCron ? "Salvando..." : "Salvar"}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="text-xs px-2 py-1 rounded bg-surface-hover text-primary hover:bg-border-strong transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <code className="text-[10px] text-secondary font-mono bg-surface px-1.5 py-0.5 rounded flex-1">
                      {schedule.cronExpression}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleEditCron(schedule.id, schedule.cronExpression)}
                      className="text-[10px] text-primary0 hover:text-secondary transition-colors"
                    >
                      ✏️
                    </button>
                  </div>
                )}

                {/* Next run */}
                {schedule.nextRunAt && schedule.enabled && (
                  <p className="text-[10px] text-primary0">
                    Próxima: {new Date(schedule.nextRunAt).toLocaleString("pt-BR")}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-1 pt-1">
                  <button
                    type="button"
                    onClick={() => handleRunNow(schedule.id)}
                    disabled={isExecutingTask === schedule.id}
                    className="text-[10px] px-2 py-1 rounded bg-info/15 text-info border border-info/30 hover:bg-info/15 disabled:opacity-50 transition-colors"
                    title="Executar agora"
                  >
                    {isExecutingTask === schedule.id ? "🚀 Executando..." : "🚀 Executar agora"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleSchedule(schedule.id, schedule.enabled)}
                    disabled={isTogglingTask === schedule.id}
                    className={`text-[10px] px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                      schedule.enabled
                        ? "bg-success/15 text-success border-success/30 hover:bg-success/15"
                        : "bg-surface text-primary0 border-strong/40 hover:bg-surface-hover"
                    }`}
                    title="Ativar/desativar agendamento"
                  >
                    {isTogglingTask === schedule.id
                      ? "⏸️ Processando..."
                      : schedule.enabled
                        ? "⏸️ Desativar"
                        : "▶️ Ativar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleViewRuns(schedule.id)}
                    className="text-[10px] px-2 py-1 rounded bg-surface text-secondary border border-strong/40 hover:bg-surface-hover transition-colors"
                    title="Ver histórico de execuções"
                  >
                    📜 Histórico
                  </button>
                </div>

                {/* Runs history dropdown */}
                {selectedTaskId === schedule.id && selectedTaskRuns.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-strong/50 space-y-1">
                    <p className="text-[10px] text-primary0 font-medium">Últimas execuções:</p>
                    {selectedTaskRuns.slice(0, 3).map((run) => (
                      <div key={run.id} className="text-[9px] text-secondary flex justify-between">
                        <span>
                          {run.status === "completed" ? "✅" : run.status === "failed" ? "❌" : "⏱️"}{" "}
                          {run.startedAt
                            ? new Date(run.startedAt).toLocaleString("pt-BR")
                            : "data desconhecida"}
                        </span>
                        <span className="text-dimmed">{run.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
