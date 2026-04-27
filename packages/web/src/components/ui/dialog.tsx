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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={() => onCloseRef.current()}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative glass-dialog text-primary rounded-xl border p-6 w-full ${{ sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl", "2xl": "max-w-2xl", "5xl": "max-w-5xl" }[size]} shadow-2xl shadow-black/50 focus:outline-none`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => onCloseRef.current()}
            data-dialog-close
            className="text-primary0 hover:text-secondary cursor-pointer"
            aria-label={`Fechar ${title}`}
          >
            &#x2715;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
