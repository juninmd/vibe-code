import { type ReactNode, useEffect, useId, useRef } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "5xl";
}

export function Dialog({ open, onClose, title, children, size = "md" }: DialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  // Keep onClose in a ref so the effect never re-runs just because the parent
  // created a new inline function reference — that was causing the focus to jump
  // to the close button every time a parent re-render happened while the dialog
  // was open (e.g. on every incoming WebSocket log message).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    const focusTarget = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      // Focus the dialog container itself so the user can start interacting
      // without accidentally triggering the close button. Individual dialogs
      // can forward focus wherever they want by autofocusing their own elements.
      const firstInteractive = Array.from(focusable).find(
        (el) => !el.closest("[data-dialog-close]") && el !== closeButtonRef.current
      );
      (firstInteractive ?? closeButtonRef.current ?? dialog).focus();
    };

    queueMicrotask(focusTarget);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Don't close when user is actively typing in an input/textarea
        const active = document.activeElement;
        const isTyping =
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          (active as HTMLElement | null)?.isContentEditable === true;
        if (!isTyping) onCloseRef.current();
        return;
      }

      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute("disabled"));

      if (focusable.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previousActiveElementRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-all animate-in fade-in duration-300"
        onClick={() => onCloseRef.current()}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative glass-panel text-primary rounded-[2rem] border border-white/10 p-8 w-full ${{ sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl", "2xl": "max-w-2xl", "5xl": "max-w-5xl" }[size]} shadow-2xl shadow-black/60 focus:outline-none animate-in zoom-in-95 fade-in duration-300 ease-out`}
      >
        <div className="flex items-start justify-between mb-6">
          <div className="space-y-1">
            <h2 id={titleId} className="text-xl font-black tracking-tight text-primary">
              {title}
            </h2>
            <div className="h-1 w-8 bg-accent rounded-full opacity-50" />
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => onCloseRef.current()}
            data-dialog-close
            className="p-2 rounded-xl text-muted hover:text-primary hover:bg-white/5 transition-all active-shrink cursor-pointer"
            aria-label={`Fechar ${title}`}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <title>Close</title>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="relative z-10">{children}</div>
      </div>
    </div>
  );
}
