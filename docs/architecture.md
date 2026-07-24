# Architecture

```mermaid
flowchart TB
    Client[Nuxt_Client]
    Server[Fastify_WS_Server]
    Rules[packages_rules]
    MCP[MCP_Server]
    LLM[llm_player]
    Agent[Cursor_Agent]

    Client -->|HTTP_WS| Server
    Server --> Rules
    MCP -->|HTTP| Server
    LLM --> Rules
    Agent --> MCP
```

## Principles

1. **Authoritative server** — clients and MCP never mutate state directly
2. **Shared rules** — `@galaxy/rules` for validation and observation
3. **Geometry-first observation** — ASCII map + spatial summary for LLM strategy
4. **MCP for external agents** — internal LLM player uses rules directly

See [Galaxy Andromeda App plan](../.cursor/plans/) for full game design.
