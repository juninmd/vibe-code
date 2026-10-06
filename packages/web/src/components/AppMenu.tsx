import { useEffect, useRef, useState } from "react";

interface AppMenuProps {
  /** Signed-in user; only meaningful when auth is enabled. */
  user?: { username: string; avatarUrl?: string } | null;
  authEnabled: boolean;
  onShortcuts: () => void;
  onChangelog: () => void;
  onSignOut: () => void;
}

/**
 * Overflow menu for the rarely used header actions. The avatar used to sign the user
 * out on a single click; signing out now sits behind a menu and a clear label.
 */
export function AppMenu({ user, authEnabled, onShortcuts, onChangelog, onSignOut }: AppMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const showUser = authEnabled && !!user;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const items: Array<{ label: string; action: () => void }> = [
    { label: "Keyboard shortcuts", action: onShortcuts },
    { label: "What's new", action: onChangelog },
  ];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: container only intercepts Escape for its menu
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          // Close the menu, not whatever panel is open behind it.
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
      >
        {showUser && user?.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full" />
        ) : showUser ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">
            {user?.username[0]?.toUpperCase()}
          </span>
        ) : (
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3" cy="8" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="13" cy="8" r="1.3" />
          </svg>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-bg-app py-1 text-sm shadow-2xl shadow-black/60"
        >
          {showUser && (
            <div className="border-b border-white/10 px-3 py-2 text-xs text-text-dimmed">
              Signed in as{" "}
              <span className="font-semibold text-text-primary">@{user?.username}</span>
            </div>
          )}
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={choose(item.action)}
              className="block w-full px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            >
              {item.label}
            </button>
          ))}
          {showUser && (
            <button
              type="button"
              role="menuitem"
              onClick={choose(onSignOut)}
              className="block w-full border-t border-white/10 px-3 py-2 text-left text-danger hover:bg-surface-hover"
            >
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}
