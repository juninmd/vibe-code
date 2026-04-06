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
    const saved = localStorage.getItem("vibe-code-theme");
    if (saved && themes[saved]) return saved;
    return "dark";
  });

  const theme = themes[themeName] ?? themes.dark;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((name: string) => {
    if (!themes[name]) return;
    setThemeName(name);
    localStorage.setItem("vibe-code-theme", name);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, themeName, setTheme }}>{children}</ThemeContext.Provider>
  );
}
