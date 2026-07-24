param(
  [Parameter(Mandatory = $true)]
  [string]$Branch,

  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

if (-not (Test-Path (Join-Path $Root ".git"))) {
  throw "Not a git repository: $Root"
}

Push-Location $Root
try {
  git fetch origin 2>$null
  git branch $Branch 2>$null
  git worktree add $Path $Branch
  Write-Host "Worktree created at $Path on branch $Branch"
  Write-Host "Next: cd $Path && pnpm install"
} finally {
  Pop-Location
}
