import type { ExternalApp } from "@vibe-code/shared";

export interface OpenInExternalAppOption {
  id: ExternalApp;
  label: string;
  displayLabel?: string;
}

export const FINDER_OPTIONS: OpenInExternalAppOption[] = [{ id: "finder", label: "Finder" }];

export const IDE_OPTIONS: OpenInExternalAppOption[] = [
  { id: "cursor", label: "Cursor" },
  { id: "antigravity", label: "Antigravity" },
  { id: "windsurf", label: "Windsurf" },
  { id: "zed", label: "Zed" },
  { id: "sublime", label: "Sublime Text" },
  { id: "xcode", label: "Xcode" },
];

export const TERMINAL_OPTIONS: OpenInExternalAppOption[] = [
  { id: "iterm", label: "iTerm" },
  { id: "warp", label: "Warp" },
  { id: "terminal", label: "Terminal" },
  { id: "ghostty", label: "Ghostty" },
];

export const APP_OPTIONS: OpenInExternalAppOption[] = [
  ...FINDER_OPTIONS,
  ...IDE_OPTIONS,
  ...TERMINAL_OPTIONS,
];

export const VSCODE_OPTIONS: OpenInExternalAppOption[] = [
  { id: "vscode", label: "Standard", displayLabel: "VS Code" },
  { id: "vscode-insiders", label: "Insiders", displayLabel: "VS Code Insiders" },
];

export const JETBRAINS_OPTIONS: OpenInExternalAppOption[] = [
  { id: "intellij", label: "IntelliJ IDEA" },
  { id: "webstorm", label: "WebStorm" },
  { id: "pycharm", label: "PyCharm" },
  { id: "phpstorm", label: "PhpStorm" },
  { id: "rubymine", label: "RubyMine" },
  { id: "goland", label: "GoLand" },
  { id: "clion", label: "CLion" },
  { id: "rider", label: "Rider" },
  { id: "datagrip", label: "DataGrip" },
  { id: "appcode", label: "AppCode" },
  { id: "fleet", label: "Fleet" },
  { id: "rustrover", label: "RustRover" },
  { id: "android-studio", label: "Android Studio" },
];

export const ALL_APP_OPTIONS: OpenInExternalAppOption[] = [
  ...APP_OPTIONS,
  ...VSCODE_OPTIONS,
  ...JETBRAINS_OPTIONS,
];

export const getAppOption = (id: ExternalApp): OpenInExternalAppOption | undefined =>
  ALL_APP_OPTIONS.find((app) => app.id === id);
