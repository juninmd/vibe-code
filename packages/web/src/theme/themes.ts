export interface ThemeColors {
  // Backgrounds
  bgApp: string;
  bgSurface: string;
  bgSurfaceHover: string;
  bgCard: string;
  bgInput: string;
  bgOverlay: string;

  // Glass
  glassSurface: string;
  glassCard: string;
  glassDialog: string;
  glassBorder: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDimmed: string;

  // Borders
  borderDefault: string;
  borderSubtle: string;
  borderStrong: string;

  // Accent
  accent: string;
  accentHover: string;
  accentMuted: string;
  accentText: string;

  // Status colors
  success: string;
  warning: string;
  danger: string;
  info: string;

  // Scrollbar
  scrollThumb: string;
  scrollThumbHover: string;

  // Selection
  selection: string;

  // Glow
  glowColor: string;

  // Gradients (CSS gradient strings)
  bgGradient1: string;
  bgGradient2: string;
  bgGradient3: string;
}

export interface Theme {
  name: string;
  label: string;
  colors: ThemeColors;
}

export const darkTheme: Theme = {
  name: "dark",
  label: "Dark",
  colors: {
    bgApp: "#09090b",
    bgSurface: "rgba(24, 24, 27, 0.85)",
    bgSurfaceHover: "rgba(39, 39, 42, 0.6)",
    bgCard: "rgba(39, 39, 42, 0.52)",
    bgInput: "rgba(24, 24, 27, 0.8)",
    bgOverlay: "rgba(0, 0, 0, 0.6)",

    glassSurface: "rgba(24, 24, 27, 0.85)",
    glassCard: "rgba(39, 39, 42, 0.52)",
    glassDialog: "rgba(24, 24, 27, 0.92)",
    glassBorder: "rgba(255, 255, 255, 0.055)",

    textPrimary: "#e4e4e7",
    textSecondary: "#a1a1aa",
    textMuted: "#71717a",
    textDimmed: "#52525b",

    borderDefault: "rgba(63, 63, 70, 0.5)",
    borderSubtle: "rgba(255, 255, 255, 0.055)",
    borderStrong: "rgba(82, 82, 91, 0.8)",

    accent: "#7c3aed",
    accentHover: "#8b5cf6",
    accentMuted: "rgba(124, 58, 237, 0.2)",
    accentText: "#c4b5fd",

    success: "#10b981",
    warning: "#f59e0b",
    danger: "#ef4444",
    info: "#3b82f6",

    scrollThumb: "rgba(63, 63, 70, 0.5)",
    scrollThumbHover: "rgba(82, 82, 91, 0.8)",

    selection: "rgba(124, 58, 237, 0.3)",
    glowColor: "rgba(59, 130, 246, 0.18)",

    bgGradient1:
      "radial-gradient(ellipse 70% 40% at 15% 0%, rgba(124, 58, 237, 0.09) 0%, transparent 65%)",
    bgGradient2:
      "radial-gradient(ellipse 60% 35% at 85% 100%, rgba(16, 185, 129, 0.06) 0%, transparent 65%)",
    bgGradient3:
      "radial-gradient(ellipse 50% 30% at 50% 50%, rgba(59, 130, 246, 0.03) 0%, transparent 70%)",
  },
};

export const lightTheme: Theme = {
  name: "light",
  label: "Light",
  colors: {
    bgApp: "#f8fafc",
    bgSurface: "rgba(255, 255, 255, 0.9)",
    bgSurfaceHover: "rgba(241, 245, 249, 0.8)",
    bgCard: "rgba(255, 255, 255, 0.85)",
    bgInput: "rgba(248, 250, 252, 0.9)",
    bgOverlay: "rgba(0, 0, 0, 0.3)",

    glassSurface: "rgba(255, 255, 255, 0.9)",
    glassCard: "rgba(255, 255, 255, 0.85)",
    glassDialog: "rgba(255, 255, 255, 0.95)",
    glassBorder: "rgba(0, 0, 0, 0.08)",

    textPrimary: "#1e293b",
    textSecondary: "#475569",
    textMuted: "#94a3b8",
    textDimmed: "#cbd5e1",

    borderDefault: "rgba(226, 232, 240, 0.8)",
    borderSubtle: "rgba(0, 0, 0, 0.06)",
    borderStrong: "rgba(203, 213, 225, 0.9)",

    accent: "#7c3aed",
    accentHover: "#6d28d9",
    accentMuted: "rgba(124, 58, 237, 0.1)",
    accentText: "#6d28d9",

    success: "#059669",
    warning: "#d97706",
    danger: "#dc2626",
    info: "#2563eb",

    scrollThumb: "rgba(203, 213, 225, 0.6)",
    scrollThumbHover: "rgba(148, 163, 184, 0.8)",

    selection: "rgba(124, 58, 237, 0.15)",
    glowColor: "rgba(59, 130, 246, 0.12)",

    bgGradient1:
      "radial-gradient(ellipse 70% 40% at 15% 0%, rgba(124, 58, 237, 0.04) 0%, transparent 65%)",
    bgGradient2:
      "radial-gradient(ellipse 60% 35% at 85% 100%, rgba(16, 185, 129, 0.03) 0%, transparent 65%)",
    bgGradient3:
      "radial-gradient(ellipse 50% 30% at 50% 50%, rgba(59, 130, 246, 0.02) 0%, transparent 70%)",
  },
};

export const draculaTheme: Theme = {
  name: "dracula",
  label: "Dracula",
  colors: {
    bgApp: "#282a36",
    bgSurface: "rgba(40, 42, 54, 0.92)",
    bgSurfaceHover: "rgba(68, 71, 90, 0.6)",
    bgCard: "rgba(68, 71, 90, 0.52)",
    bgInput: "rgba(40, 42, 54, 0.85)",
    bgOverlay: "rgba(0, 0, 0, 0.5)",

    glassSurface: "rgba(40, 42, 54, 0.92)",
    glassCard: "rgba(68, 71, 90, 0.52)",
    glassDialog: "rgba(40, 42, 54, 0.95)",
    glassBorder: "rgba(255, 255, 255, 0.07)",

    textPrimary: "#f8f8f2",
    textSecondary: "#bfbfca",
    textMuted: "#6272a4",
    textDimmed: "#44475a",

    borderDefault: "rgba(68, 71, 90, 0.6)",
    borderSubtle: "rgba(255, 255, 255, 0.06)",
    borderStrong: "rgba(98, 114, 164, 0.5)",

    accent: "#bd93f9",
    accentHover: "#caa6fc",
    accentMuted: "rgba(189, 147, 249, 0.2)",
    accentText: "#bd93f9",

    success: "#50fa7b",
    warning: "#f1fa8c",
    danger: "#ff5555",
    info: "#8be9fd",

    scrollThumb: "rgba(68, 71, 90, 0.6)",
    scrollThumbHover: "rgba(98, 114, 164, 0.7)",

    selection: "rgba(189, 147, 249, 0.3)",
    glowColor: "rgba(139, 233, 253, 0.15)",

    bgGradient1:
      "radial-gradient(ellipse 70% 40% at 15% 0%, rgba(189, 147, 249, 0.08) 0%, transparent 65%)",
    bgGradient2:
      "radial-gradient(ellipse 60% 35% at 85% 100%, rgba(80, 250, 123, 0.05) 0%, transparent 65%)",
    bgGradient3:
      "radial-gradient(ellipse 50% 30% at 50% 50%, rgba(139, 233, 253, 0.03) 0%, transparent 70%)",
  },
};

export const themes: Record<string, Theme> = {
  dark: darkTheme,
  light: lightTheme,
  dracula: draculaTheme,
};

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const c = theme.colors;

  root.setAttribute("data-theme", theme.name);

  root.style.setProperty("--bg-app", c.bgApp);
  root.style.setProperty("--bg-surface", c.bgSurface);
  root.style.setProperty("--bg-surface-hover", c.bgSurfaceHover);
  root.style.setProperty("--bg-card", c.bgCard);
  root.style.setProperty("--bg-input", c.bgInput);
  root.style.setProperty("--bg-overlay", c.bgOverlay);

  root.style.setProperty("--glass-surface", c.glassSurface);
  root.style.setProperty("--glass-card", c.glassCard);
  root.style.setProperty("--glass-dialog", c.glassDialog);
  root.style.setProperty("--glass-border", c.glassBorder);

  root.style.setProperty("--text-primary", c.textPrimary);
  root.style.setProperty("--text-secondary", c.textSecondary);
  root.style.setProperty("--text-muted", c.textMuted);
  root.style.setProperty("--text-dimmed", c.textDimmed);

  root.style.setProperty("--border-default", c.borderDefault);
  root.style.setProperty("--border-subtle", c.borderSubtle);
  root.style.setProperty("--border-strong", c.borderStrong);

  root.style.setProperty("--accent", c.accent);
  root.style.setProperty("--accent-hover", c.accentHover);
  root.style.setProperty("--accent-muted", c.accentMuted);
  root.style.setProperty("--accent-text", c.accentText);

  root.style.setProperty("--success", c.success);
  root.style.setProperty("--warning", c.warning);
  root.style.setProperty("--danger", c.danger);
  root.style.setProperty("--info", c.info);

  root.style.setProperty("--scroll-thumb", c.scrollThumb);
  root.style.setProperty("--scroll-thumb-hover", c.scrollThumbHover);
  root.style.setProperty("--selection", c.selection);
  root.style.setProperty("--glow-color", c.glowColor);

  root.style.setProperty("--bg-gradient-1", c.bgGradient1);
  root.style.setProperty("--bg-gradient-2", c.bgGradient2);
  root.style.setProperty("--bg-gradient-3", c.bgGradient3);
}
