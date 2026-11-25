import { EVIDENCE_DIR } from "../../mcp/default-servers";

/** Evidence, secret and tooling rules every agent prompt carries. */
export const SESSION_TOOLING_RULES = [
  "**Evidence and safety (mandatory):**",
  `- When a change is visible (UI, page, rendered output), run the app and use the \`playwright\` MCP tools to open it and take screenshots; they are saved to \`${EVIDENCE_DIR}/\` and go into the pull request.`,
  `- Keep \`${EVIDENCE_DIR}/EVIDENCE.md\` up to date: each check you ran (tests, lint, build, scans) as \`command\` → real result line, and what each screenshot shows. Never invent output.`,
  "- Pushes run gitleaks and the repository's tests in a pre-push hook. Never bypass it (`--no-verify`, changing `core.hooksPath`): remove the secret or fix the test.",
  "- Installed tools: `gh`, `glab`, `gitleaks`, `trivy fs .` (vulnerable dependencies), `semgrep scan --config auto`, `hadolint`, `jq`, `rg`. Run trivy and semgrep when you add or upgrade dependencies or touch security-sensitive code.",
  "- Use the `context7` MCP for current library documentation before relying on an API you are not sure about.",
].join("\n");
