export const EXTERNAL_APPS = [
  "finder",
  "vscode",
  "vscode-insiders",
  "cursor",
  "antigravity",
  "windsurf",
  "zed",
  "sublime",
  "xcode",
  "iterm",
  "warp",
  "terminal",
  "ghostty",
  "intellij",
  "webstorm",
  "pycharm",
  "phpstorm",
  "rubymine",
  "goland",
  "clion",
  "rider",
  "datagrip",
  "appcode",
  "fleet",
  "rustrover",
  "android-studio",
] as const;

export type ExternalApp = (typeof EXTERNAL_APPS)[number];

const MACOS_APP_NAMES: Record<ExternalApp, string | null> = {
  finder: "Finder",
  vscode: "Visual Studio Code",
  "vscode-insiders": "Visual Studio Code - Insiders",
  cursor: "Cursor",
  antigravity: "Antigravity",
  windsurf: "Windsurf",
  zed: "Zed",
  xcode: "Xcode",
  iterm: "iTerm",
  warp: "Warp",
  terminal: "Terminal",
  ghostty: "Ghostty",
  sublime: "Sublime Text",
  intellij: null, // Multi-edition, uses bundle IDs
  webstorm: "WebStorm",
  pycharm: null, // Multi-edition, uses bundle IDs
  phpstorm: "PhpStorm",
  rubymine: "RubyMine",
  goland: "GoLand",
  clion: "CLion",
  rider: "Rider",
  datagrip: "DataGrip",
  appcode: "AppCode",
  fleet: "Fleet",
  rustrover: "RustRover",
  "android-studio": "Android Studio",
};

const BUNDLE_ID_CANDIDATES: Partial<Record<ExternalApp, string[]>> = {
  intellij: ["com.jetbrains.intellij", "com.jetbrains.intellij.ce"],
  pycharm: ["com.jetbrains.pycharm", "com.jetbrains.pycharm.ce"],
};

const LINUX_CLI_COMMANDS: Record<ExternalApp, string | null> = {
  finder: null,
  vscode: "code",
  "vscode-insiders": "code-insiders",
  cursor: "cursor",
  antigravity: "antigravity",
  windsurf: "windsurf",
  zed: "zed",
  xcode: null,
  iterm: null,
  warp: "warp-terminal",
  terminal: null,
  ghostty: "ghostty",
  sublime: "subl",
  intellij: null,
  webstorm: "webstorm",
  pycharm: null,
  phpstorm: "phpstorm",
  rubymine: "rubymine",
  goland: "goland",
  clion: "clion",
  rider: "rider",
  datagrip: "datagrip",
  appcode: null,
  fleet: "fleet",
  rustrover: "rustrover",
  "android-studio": "studio",
};

const LINUX_CLI_CANDIDATES: Partial<Record<ExternalApp, string[]>> = {
  intellij: ["idea", "intellij-idea-ultimate", "intellij-idea-community"],
  pycharm: ["pycharm", "pycharm-professional", "pycharm-community"],
};

export function getAppCommand(
  app: ExternalApp,
  targetPath: string,
  platform?: string
): { command: string; args: string[] }[] | null {
  if (platform === "darwin") {
    const bundleIds = BUNDLE_ID_CANDIDATES[app];
    if (bundleIds) {
      return bundleIds.map((id) => ({
        command: "open",
        args: ["-b", id, targetPath],
      }));
    }

    const appName = MACOS_APP_NAMES[app];
    if (!appName) return null;
    return [{ command: "open", args: ["-a", appName, targetPath] }];
  }

  const linuxCandidates = LINUX_CLI_CANDIDATES[app];
  if (linuxCandidates) {
    return linuxCandidates.map((cmd) => ({
      command: cmd,
      args: [targetPath],
    }));
  }

  const cliCommand = LINUX_CLI_COMMANDS[app];
  if (!cliCommand) return null;
  return [{ command: cliCommand, args: [targetPath] }];
}
