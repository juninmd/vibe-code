export async function verifyWorktree(
  _wtPath: string,
  sysLog: (content: string) => void
): Promise<void> {
  sysLog("Final verification is delegated to the coding CLI agent.");
  sysLog("The agent must run lint, test, and build using the repository's own commands.");
  sysLog("Server-side hardcoded language/package-manager verification is disabled.");
}
