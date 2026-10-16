import { useState } from "react";
import { useInstallPrompt } from "../hooks/useInstallPrompt";

/**
 * Slim install affordance. Uses the native `beforeinstallprompt` where
 * available and falls back to iOS "Add to Home Screen" instructions.
 */
export function InstallBanner() {
  const { canInstall, showIosHint, promptInstall, dismiss } = useInstallPrompt();
  const [expanded, setExpanded] = useState(false);

  if (!canInstall && !showIosHint) return null;

  return (
    <div className="shrink-0 border-b border-white/8 bg-accent/8 px-3 py-2">
      <div className="flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" width={28} height={28} className="rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-primary">Install Harness Remote</p>
          <p className="truncate text-[11px] text-muted">
            {canInstall
              ? "Add it to your home screen for a full-screen app."
              : "Add it to your home screen."}
          </p>
        </div>
        {canInstall ? (
          <button
            type="button"
            onClick={() => {
              void promptInstall();
            }}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-white"
          >
            Install
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 rounded-lg border border-accent/30 px-3 py-1.5 text-[11px] font-semibold text-accent"
          >
            How?
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install banner"
          className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:text-primary"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <title>Dismiss</title>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      {expanded && showIosHint && (
        <p className="mt-2 pl-10 text-[11px] leading-relaxed text-secondary">
          In Safari, tap the <span className="font-semibold">Share</span> button, then choose{" "}
          <span className="font-semibold">Add to Home Screen</span>.
        </p>
      )}
    </div>
  );
}
