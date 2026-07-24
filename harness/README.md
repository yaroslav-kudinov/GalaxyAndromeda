# Harness

Tooling for agent development, MCP integration, and smoke tests.

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

## Scenarios

JSON fixtures in `scenarios/` for rules tests and agent replay.

## Agent smoke

`agent-smoke/` — end-to-end MCP → server flow (Batch 3).
