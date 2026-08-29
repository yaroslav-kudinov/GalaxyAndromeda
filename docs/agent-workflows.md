# Agent workflows — git worktrees

## Convention

- Root repo: `E:\PetsAndTests\GalaxyAndromedaTabletop`
- Worktree path: `E:\PetsAndTests\GalaxyAndromeda-<scope>`
- Branch: `agent/<scope>` (kebab-case)

## Create worktree

```powershell
cd E:\PetsAndTests\GalaxyAndromedaTabletop
./harness/scripts/new-worktree.ps1 -Branch agent/rules-core -Path ../GalaxyAndromeda-rules-core
cd ../GalaxyAndromeda-rules-core
pnpm install
```

Open new Cursor window on worktree path. Use separate chat per agent.

## Batch 1 (parallel, after scaffold on main)

| Branch | Scope |
|--------|-------|
| `agent/rules-core` | hex, map, observation, YAML |
| `agent/server-scaffold` | server (done in scaffold; extend) |
| `agent/client-scaffold` | Nuxt UI (done in scaffold; extend) |
| `agent/harness-mcp` | MCP tools |
| `agent/docs-data` | rulebook, maps, skills |

## Merge workflow

1. In worktree: `pnpm test && pnpm typecheck`
2. `git rebase main`
3. In root: `./harness/scripts/merge-agent-branch.ps1 -Branch agent/xxx`
4. `git worktree remove ../GalaxyAndromeda-xxx`

## Contract changes

Changes to `packages/rules/src/types.ts` require ADR in `docs/decisions/`.

## Patch notes

Any code/rules/API/UI change: add a structured note in `docs/patch-notes/` (see `.cursor/rules/patch-notes.mdc` — write for the player, glossary, no abbreviations). Changelog stays a short feed; patch notes explain impact for agents and players.
