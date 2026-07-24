# Galaxy Andromeda Tabletop

Prototype web app for the **Galaxy Andromeda** board game — rules engine, Nuxt client, multiplayer server, MCP harness for AI agents.

## Quick start

```bash
pnpm install
pnpm dev          # Nuxt :3000 + server :3001
pnpm test
pnpm typecheck
```

## Packages

| Package | Description |
|---------|-------------|
| `@galaxy/rules` | Pure TS rules, map math, observation (ASCII geometry) |
| `@galaxy/server` | Fastify + WebSocket game server |
| `@galaxy/client` | Nuxt 3 SPA (lobby, editor, game) |
| `@galaxy/llm-player` | LLM agent prompt/parser |
| `@galaxy/mcp-server` | MCP tools for Cursor agents |

## Docs

- [AGENTS.md](./AGENTS.md) — agent workflow
- [docs/agent-workflows.md](./docs/agent-workflows.md) — git worktrees
- [docs/rulebook.md](./docs/rulebook.md) — game rules
- Game design plan: `.cursor/plans/galaxy_andromeda_app_*.plan.md`

## MCP

Add `.cursor/mcp.json` (included). Start server first, then enable MCP in Cursor.
