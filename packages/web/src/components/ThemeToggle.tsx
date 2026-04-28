import { useCallback, useEffect, useState } from "react";

const THEME_KEY = "vibe-code-theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function getStoredTheme(): "light" | "dark" | "system" {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: "light" | "dark") {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}

function resolveTheme(theme: "light" | "dark" | "system"): "light" | "dark" {
  return theme === "system" ? getSystemTheme() : theme;
}

interface ThemeToggleProps {
  onThemeChange?: (theme: "light" | "dark") => void;
}

export function ThemeToggle({ onThemeChange }: ThemeToggleProps) {
  const [stored, setStored] = useState<"light" | "dark" | "system">("system");
  const [current, setCurrent] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const storedTheme = getStoredTheme();
    setStored(storedTheme);
    setCurrent(resolveTheme(storedTheme));
  }, []);

  useEffect(() => {
    applyTheme(current);
  }, [current]);

  useEffect(() => {
    if (stored !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => setCurrent(getSystemTheme());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [stored]);

  const toggle = useCallback(() => {
    const next = current === "dark" ? "light" : "dark";
    setCurrent(next);
    setStored(next);
    onThemeChange?.(next);
  }, [current, onThemeChange]);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${current === "dark" ? "light" : "dark"} theme`}
      title={`Theme: ${current === "dark" ? "dark" : "light"} (click to toggle)`}
      className="p-1 rounded-md text-dimmed hover:text-secondary hover:bg-surface-hover transition-all cursor-pointer"
    >
      {current === "dark" ? (
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
