$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $Root
git worktree list
Pop-Location
