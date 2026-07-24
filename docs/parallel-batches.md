# Parallel worktree branches (reference)

Batch 1–3 deliverables are implemented on `main` in the bootstrap session.
Use these branches when splitting work across agents:

| Branch | Status on main |
|--------|----------------|
| `agent/rules-core` | map, observation, YAML, tests |
| `agent/server-scaffold` | Fastify + HTTP rooms |
| `agent/client-scaffold` | Nuxt + HexBoard |
| `agent/harness-mcp` | MCP tools |
| `agent/docs-data` | rulebook stub, skills |
| `agent/rules-gameplay` | combat/production stubs |
| `agent/client-editor` | /editor |
| `agent/server-game` | room API |
| `agent/llm-player` | prompt parser |
| `agent/client-game` | game page + composables |
| `agent/harness-smoke` | run-smoke.ts |

Create fresh worktrees from `main` for new feature work.
