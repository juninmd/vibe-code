import type { TaskScheduleWithTask } from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

interface SchedulesSidebarProps {
  onClose: () => void;
}

export function SchedulesSidebar({ onClose }: SchedulesSidebarProps) {
  const [schedules, setSchedules] = useState<TaskScheduleWithTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSchedules = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    setError(null);
    try {
      const data = await api.schedules.listAll();
      setSchedules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao buscar agendamentos");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const enabledCount = schedules.filter((s) => s.schedule.enabled).length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <button
        type="button"
        aria-label="Fechar painel de agendamentos"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative h-full w-full max-w-md glass-panel border-l flex flex-col overflow-hidden shadow-2xl shadow-black/40">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-primary">Tasks Scheduled</h2>
            <p className="text-xs text-primary0 mt-0.5">
              {loading ? (
                <span className="animate-pulse">Buscando...</span>
              ) : (
                <>
                  {enabledCount}/{schedules.length} ativos
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchSchedules(true)}
              disabled={refreshing || loading}
              title="Atualizar"
              className="p-1.5 rounded-lg text-primary0 hover:text-secondary hover:bg-surface-hover cursor-pointer transition-colors text-sm disabled:opacity-40"
            >
              <span className={refreshing ? "inline-block animate-spin" : ""}>↻</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="bg-danger/15 border border-danger/30 text-danger p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {loading && schedules.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 bg-surface/30 rounded-xl border border-white/[0.02] animate-pulse"
                />
              ))}
            </div>
          ) : schedules.length === 0 ? (
            <div className="text-center py-10">
              <div className="text-dimmed text-4xl mb-3">🕒</div>
              <h3 className="text-sm font-medium text-secondary">Sem agendamentos</h3>
              <p className="text-xs text-primary0 mt-1">Nenhuma task está agendada no momento.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {schedules.map(({ schedule, task }) => (
                <div
                  key={schedule.id}
                  className={`rounded-xl border p-4 transition-all duration-200 ${
                    schedule.enabled
                      ? "bg-input border-strong/50"
                      : "bg-input/50 border-default opacity-70"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        schedule.enabled ? "bg-info/15" : "bg-surface/50"
                      } border ${schedule.enabled ? "border-info/30" : "border-strong/30"}`}
                    >
                      <span className={schedule.enabled ? "text-info" : "text-dimmed"}>🕒</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-primary truncate">
                          {task.title}
                        </h3>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                            schedule.enabled
                              ? "bg-success/15 text-success border border-success/30"
                              : "bg-surface text-primary0 border border-strong/40"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              schedule.enabled ? "bg-emerald-400 animate-pulse" : "bg-border-strong"
                            }`}
                          />
                          {schedule.enabled ? "ativo" : "inativo"}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-col gap-1">
                        <div className="text-[11px] text-secondary flex items-center gap-1.5">
                          <span className="font-mono bg-surface px-1 py-0.5 rounded text-secondary">
                            {schedule.cronExpression}
                          </span>
                        </div>
                        {schedule.nextRunAt && schedule.enabled && (
                          <div className="text-[11px] text-primary0">
                            Próxima run: {new Date(schedule.nextRunAt).toLocaleString()}
                          </div>
                        )}
                        {task.repo && (
                          <div className="text-[11px] text-dimmed mt-1 truncate">
                            Repo: {task.repo.name}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
