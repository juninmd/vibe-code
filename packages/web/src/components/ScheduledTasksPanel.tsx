import { useCallback, useState } from "react";
import { useScheduledTasks } from "../hooks/useScheduledTasks";
import { Button } from "./ui/button";

export function ScheduledTasksPanel() {
  const { tasks, loading, error, refetch } = useScheduledTasks();
  const [isExecutingTask, setIsExecutingTask] = useState<string | null>(null);

  const handleRunNow = useCallback(
    async (taskId: string) => {
      setIsExecutingTask(taskId);
      try {
        const response = await fetch(`/api/tasks/${taskId}/schedule/run-now`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) throw new Error("Trigger failed");
        refetch();
      } catch {
      } finally {
        setIsExecutingTask(null);
      }
    },
    [refetch]
  );

  const handleToggleSchedule = useCallback(
    async (taskId: string, currentEnabled: boolean) => {
      try {
        const response = await fetch(`/api/tasks/${taskId}/schedule/toggle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !currentEnabled }),
        });
        if (!response.ok) throw new Error("Toggle failed");
        refetch();
      } catch {}
    },
    [refetch]
  );

  return (
    <div className="flex flex-col h-full bg-black/20">
      <div className="p-8 border-b border-white/5 bg-white/[0.02] flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-xl font-black tracking-tight text-primary">Task Automations</h2>
          <div className="flex items-center gap-2 mt-2">
            <div className="h-1 w-6 bg-accent rounded-full" />
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-dimmed">
              Cron Schedules
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="p-2 rounded-xl text-muted hover:text-primary hover:bg-white/5 transition-all cursor-pointer"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className={loading ? "animate-spin" : ""}
            aria-hidden="true"
          >
            <title>Refresh</title>
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
        {error && (
          <div className="p-4 rounded-2xl bg-danger/10 border border-danger/20 text-danger text-xs font-bold">
            {error}
          </div>
        )}

        {tasks.length === 0 && !loading ? (
          <div className="py-20 text-center space-y-4 opacity-30">
            <p className="text-5xl">⏰</p>
            <p className="text-xs font-black uppercase tracking-widest">No active automations</p>
          </div>
        ) : (
          tasks.map(({ schedule, task }) => (
            <div
              key={schedule.id}
              className={`p-5 rounded-[2rem] border transition-all duration-300 ${schedule.enabled ? "bg-white/[0.03] border-white/10" : "bg-black/20 border-white/5 opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-black tracking-tight text-primary truncate">
                    {task.title}
                  </h4>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-[10px] font-black text-accent bg-accent/10 px-2 py-0.5 rounded-lg">
                      {schedule.cronExpression}
                    </code>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleSchedule(schedule.id, schedule.enabled)}
                  className={`w-12 h-7 rounded-full relative transition-all active-shrink ${schedule.enabled ? "bg-accent shadow-lg shadow-accent/25" : "bg-white/10"}`}
                >
                  <div
                    className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all shadow-sm ${schedule.enabled ? "left-6" : "left-1"}`}
                  />
                </button>
              </div>

              <div className="space-y-4">
                {schedule.nextRunAt && schedule.enabled && (
                  <div className="flex items-center gap-2 text-[10px] font-bold text-muted">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      aria-hidden="true"
                    >
                      <title>Clock</title>
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                    <span>Next execution: {new Date(schedule.nextRunAt).toLocaleString()}</span>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRunNow(schedule.id)}
                    disabled={isExecutingTask === schedule.id}
                    className="flex-1 rounded-xl h-9 text-[10px] font-black uppercase tracking-widest border-white/5 hover:bg-white/5"
                  >
                    Run Now
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-6 border-t border-white/5 bg-white/[0.02] flex justify-center">
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-muted opacity-50">
          Background Automation Engine
        </p>
      </div>
    </div>
  );
}
