import { type ReactNode, useEffect, useRef, useState } from "react";

interface CodeComposerProps {
  placeholder: string;
  /** Short hint rendered above the input (e.g. the target repository). */
  hint?: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Optional control rendered to the left of the textarea (repo picker). */
  leading?: ReactNode;
  onSubmit: (text: string) => void | Promise<void>;
}

const MAX_ROWS_PX = 160;

/** Sticky bottom composer for code mode. Enter sends, Shift+Enter adds a newline. */
export function CodeComposer({
  placeholder,
  hint,
  busy = false,
  disabled = false,
  autoFocus = false,
  leading,
  onSubmit,
}: CodeComposerProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow up to MAX_ROWS_PX.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height must follow the typed value
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const submit = async () => {
    const text = value.trim();
    if (!text || busy || disabled || pendingRef.current) return;
    pendingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(text);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send. Please try again.");
    } finally {
      pendingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="shrink-0">
      {hint && <div className="mb-2 px-1 text-[11px] text-muted">{hint}</div>}
      {error && (
        <p role="alert" className="mb-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2 rounded-xl border border-default bg-input p-3 focus-within:border-accent/60">
        {leading && <div className="shrink-0">{leading}</div>}
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled || submitting || busy}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-snug text-primary placeholder:text-muted outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || submitting || disabled || value.trim().length === 0}
          aria-label="Send"
          className="shrink-0 grid place-items-center w-10 h-10 rounded-xl bg-accent text-white transition-all hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed active-shrink"
        >
          {busy || submitting ? (
            <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <title>Send</title>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
