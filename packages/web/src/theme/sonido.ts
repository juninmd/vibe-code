/**
 * Sonido paints itself from `data-theme` on the document root, the same attribute the app
 * already uses for its own palette. The app's names mostly match the design system's, so the
 * bridge only has to translate the one theme Sonido does not publish.
 */
const SONIDO_THEME: Record<string, string> = {
  dark: "dark",
  light: "light",
  dracula: "dracula",
  // Sonido has no GitHub palette; its default dark tokens are the closest match.
  "github-dark": "dark",
};

/** The `data-theme` value both layers read; unknown themes fall back to Sonido's dark. */
export function sonidoTheme(appTheme: string): string {
  return SONIDO_THEME[appTheme] ?? "dark";
}
