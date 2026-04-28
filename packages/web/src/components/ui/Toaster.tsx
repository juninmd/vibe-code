import { useToast } from "../../hooks/useToast";

export function Toaster() {
  const { toasts, dismiss, dismissAll } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.length > 1 && (
        <button
          type="button"
          onClick={dismissAll}
          className="self-end mb-1 text-xs text-dimmed hover:text-secondary transition-colors cursor-pointer pointer-events-auto"
        >
          Dismiss all
        </button>
      )}
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`
            flex items-start gap-3 px-4 py-3 rounded-lg shadow-xl border text-sm max-w-sm
            pointer-events-auto animate-in slide-in-from-bottom-2 fade-in duration-200
            ${
              t.type === "error"
                ? "bg-red-950 border-red-800 text-danger"
                : t.type === "success"
                  ? "bg-emerald-950 border-emerald-800 text-success"
                  : "bg-surface border-strong text-primary"
            }
          `}
        >
          <span className="mt-px shrink-0 text-base leading-none">
            {t.type === "error" ? "✕" : t.type === "success" ? "✓" : "ℹ"}
          </span>
          <span className="flex-1 leading-snug">{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
              className="shrink-0 text-xs font-semibold underline cursor-pointer hover:opacity-80 transition-opacity"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-current opacity-50 hover:opacity-100 cursor-pointer transition-opacity"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
