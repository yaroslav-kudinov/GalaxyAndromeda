# Agent guide — Galaxy Andromeda Tabletop

## Stack

- **Monorepo:** pnpm workspaces, TypeScript
- **Rules:** `@galaxy/rules` — single source of truth
- **Server:** `@galaxy/server` — port 3001
- **Client:** `@galaxy/client` — Nuxt 3 SPA, port 3000
- **MCP:** `@galaxy/mcp-server` — external agent tools
- **LLM player:** `@galaxy/llm-player`

## Commands

```bash
pnpm install
pnpm dev
pnpm test
pnpm typecheck
pnpm run build:deploy   # production: rules + nuxt generate + server
pnpm start              # один процесс: API /api/* + статика клиента
pnpm --filter @galaxy/mcp-server dev
```

Деплой: [Amvera](./docs/deploy-amvera.md), [Railway](./docs/deploy-railway.md).

## Package boundaries

| Scope | Path | Do not edit without coordination |
|-------|------|----------------------------------|
| Rules | `packages/rules/` | `types.ts` needs ADR |
| Server | `packages/server/` | HTTP/WS API in `docs/agent-protocol.md` |
| Client | `packages/client/` | Vue/Nuxt UI only |
| MCP | `harness/mcp-server/` | Tool names stable for agents |
| Docs | `docs/` | Keep in sync with code |

## Parallel development (worktrees)

```powershell
./harness/scripts/new-worktree.ps1 -Branch agent/my-task -Path ../GalaxyAndromeda-my-task
```

One agent = one branch `agent/<scope>`. Merge: rebase on `main`, `pnpm test`, merge, remove worktree.

See [docs/agent-workflows.md](./docs/agent-workflows.md).

## Observation for agents

`game_get_state` returns **mechanics JSON + geometry (ASCII map + spatial summary)**. Read geometry first for strategy.

## Skills

- `.cursor/skills/galaxy-dev`
- `.cursor/skills/galaxy-debug`
- `.cursor/skills/galaxy-play`
- `.cursor/skills/galaxy-map-editor`
- `.cursor/skills/galaxy-rulebook`

## Before finishing a task

1. `pnpm test && pnpm typecheck` in your scope
2. Update `docs/changelog.md`
3. Structured patch note in `docs/patch-notes/` (see `.cursor/rules/patch-notes.mdc`: человеческий русский для игрока, глоссарий, без сокращений и англицизмов в прозе)
4. ADR for contract changes in `docs/decisions/`
