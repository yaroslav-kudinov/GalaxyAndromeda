param(
  [Parameter(Mandatory = $true)]
  [string]$Branch
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Push-Location $Root
try {
  git checkout main
  git merge $Branch --no-edit
  Write-Host "Merged $Branch into main. Run pnpm test && pnpm typecheck"
} finally {
  Pop-Location
}
