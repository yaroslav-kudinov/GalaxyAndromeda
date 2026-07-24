# ADR 002: MCP for external agents

## Status

Accepted

## Context

Cursor agents and harness scripts need to play and debug the game.

## Decision

- Game server exposes HTTP/WS API
- `harness/mcp-server` wraps API as MCP tools
- Internal `@galaxy/llm-player` calls rules/server directly (no MCP roundtrip)

## Consequences

- `.cursor/mcp.json` points to `@galaxy/mcp-server`
- Server must be running for MCP tools
