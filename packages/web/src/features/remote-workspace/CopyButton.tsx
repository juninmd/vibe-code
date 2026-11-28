import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * One clipboard action with its own success state. The label is the accessible
 * name, so the button says what it copies and confirms when it did.
 */
export function CopyButton({
  text,
  label,
  className,
  hideLabel,
}: {
  /** A string, or a reader for text that only exists in the DOM (code blocks). */
  text: string | (() => string);
  label: string;
  className?: string;
  hideLabel?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const copy = async () => {
    const value = typeof text === "function" ? text() : text;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1_600);
    } catch {
      // A denied clipboard leaves the button in its idle state; nothing is lost.
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      className={`rw-copy${copied ? " is-copied" : ""}${className ? ` ${className}` : ""}`}
      aria-label={copied ? "Copiado" : label}
      title={copied ? "Copiado" : label}
      onClick={() => void copy()}
    >
      <Icon name={copied ? "check" : "copy"} size={12} />
      {!hideLabel && <span>{copied ? "Copiado" : "Copiar"}</span>}
    </button>
  );
}
