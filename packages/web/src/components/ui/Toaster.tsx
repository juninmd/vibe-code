import { useToast } from "../../hooks/useToast";

export function Toaster() {
  const { toasts, dismiss, dismissAll } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-8 right-8 z-[200] flex flex-col gap-3 pointer-events-none max-w-sm w-full">
      {toasts.length > 1 && (
        <button
          type="button"
          onClick={dismissAll}
          className="self-end mb-2 text-[10px] font-black uppercase tracking-widest text-muted hover:text-primary transition-all cursor-pointer pointer-events-auto bg-white/5 px-3 py-1 rounded-full border border-white/5"
        >
          Clear all notifications
        </button>
      )}
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`
            flex items-start gap-4 p-5 rounded-[1.5rem] shadow-2xl border backdrop-blur-xl
            pointer-events-auto animate-in slide-in-from-right-4 fade-in duration-300
            ${
              t.type === "error"
                ? "bg-danger/10 border-danger/20 text-danger shadow-danger/10"
                : t.type === "success"
                  ? "bg-success/10 border-success/20 text-success shadow-success/10"
                  : "glass-panel border-white/10 text-primary shadow-black/40"
            }
          `}
        >
          <div
            className={`mt-0.5 shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black border ${
              t.type === "error"
                ? "border-danger/30"
                : t.type === "success"
                  ? "border-success/30"
                  : "border-white/10 bg-white/5"
            }`}
          >
            {t.type === "error" ? "!" : t.type === "success" ? "✓" : "i"}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold tracking-tight leading-snug">{t.message}</p>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
                className="mt-2 text-[10px] font-black uppercase tracking-widest underline decoration-2 underline-offset-4 cursor-pointer hover:opacity-80 transition-opacity"
              >
                {t.action.label}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 p-1 rounded-lg hover:bg-white/5 transition-all opacity-40 hover:opacity-100 cursor-pointer"
            aria-label="Dismiss"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              aria-hidden="true"
            >
              <title>Dismiss icon</title>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
