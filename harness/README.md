# Harness

Tooling for agent development, MCP integration, and smoke tests.

## CI/CD и деплой

Деплой production-сборки — **только по явной команде** (человек или отдельный deploy-workflow). Push в GitHub сам по себе не выкладывает приложение на Amvera/Railway.

См. [docs/cicd-deploy-policy.md](../docs/cicd-deploy-policy.md) и [docs/deploy-amvera.md](../docs/deploy-amvera.md).

## MCP server

```bash
pnpm --filter @galaxy/mcp-server dev
```

Configure in `.cursor/mcp.json`. Requires `@galaxy/server` running on port 3001.

## Worktrees

```powershell
./harness/scripts/new-worktree.ps1 -Branch agent/my-task -Path ../GalaxyAndromeda-my-task
```

See [docs/agent-workflows.md](../docs/agent-workflows.md).

## Simulations

Против запущенного `@galaxy/server` (адрес — `GAME_SERVER_URL`):

```bash
node harness/scripts/simulate-lobby.mjs    # 3 игрока, 3 полных хода
node harness/scripts/simulate-combat.mjs   # полный цикл боя + инвариант pendingCombat
```

## Scenarios

JSON fixtures in `scenarios/` for rules tests and agent replay.

## Agent smoke

`agent-smoke/` — end-to-end MCP → server flow (Batch 3).
