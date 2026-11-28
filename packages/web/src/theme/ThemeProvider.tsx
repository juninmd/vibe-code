import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { applyTheme, type Theme, themes } from "./themes";

interface ThemeContextValue {
  theme: Theme;
  themeName: string;
  setTheme: (name: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: themes.dark,
  themeName: "dark",
  setTheme: () => {},
});

const STORAGE_KEY = "vibe-code-theme";
const LIGHT_QUERY = "(prefers-color-scheme: light)";

function savedTheme(): string | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved && themes[saved] ? saved : null;
  } catch {
    return null;
  }
}

function systemTheme(): string {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(LIGHT_QUERY).matches
    ? "light"
    : "dark";
}

export function useTheme() {
  return useContext(ThemeContext);
}

interface ThemeProviderProps {
  children: ReactNode;
  initialTheme?: string;
}

export function ThemeProvider({ children, initialTheme }: ThemeProviderProps) {
  const [themeName, setThemeName] = useState(() => {
    if (initialTheme && themes[initialTheme]) return initialTheme;
    const saved = savedTheme();
    if (saved) return saved;
    return systemTheme();
  });

  // Until the user picks one, follow the system's light/dark setting.
  useEffect(() => {
    if (initialTheme || savedTheme() || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(LIGHT_QUERY);
    const follow = () => {
      if (!savedTheme()) setThemeName(query.matches ? "light" : "dark");
    };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [initialTheme]);

  const theme = themes[themeName] ?? themes.dark;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((name: string) => {
    if (!themes[name]) return;
    setThemeName(name);
    try {
      localStorage.setItem(STORAGE_KEY, name);
    } catch {
      /* The choice still applies to this visit. */
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, themeName, setTheme }}>{children}</ThemeContext.Provider>
  );
}
