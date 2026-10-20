param(
  [int]$Port = 5188,
  [string]$PreviewDirectory = (Join-Path ([System.IO.Path]::GetTempPath()) "vibe-code-unified-preview")
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath "packages/web/dist/index.html")) {
  throw "Compile a interface primeiro: bun run build"
}
$previewRoot = [System.IO.Path]::GetFullPath($PreviewDirectory)
$env:PORT = [string]$Port
$env:VIBE_CODE_HOST = "127.0.0.1"
$env:NODE_ENV = "production"
$env:VIBE_CODE_DATA_DIR = Join-Path $previewRoot "data"
$env:VIBE_CODE_SKILLS_PATH = Join-Path $previewRoot "skills"
$env:VIBE_CODE_MAX_AGENTS = "1"
$env:VIBE_CODE_AUTO_SWEEP = "false"
# This isolated preview is bound to loopback; production auth settings are untouched.
$env:GITHUB_OAUTH_CLIENT_ID = ""
$env:GITHUB_OAUTH_CLIENT_SECRET = ""
$env:VIBE_CODE_API_KEY = ""
New-Item -ItemType Directory -Path $env:VIBE_CODE_DATA_DIR -Force | Out-Null
Write-Output "Protótipo: http://127.0.0.1:$Port/prototype"
Write-Output "Dados isolados: $previewRoot"
& bun run packages/server/src/index.ts
exit $LASTEXITCODE
