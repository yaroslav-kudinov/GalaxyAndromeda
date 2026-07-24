---
name: galaxy-debug
description: Debug Galaxy Andromeda rules, server, MCP. Use for bugs, tests, and regression scenarios.
---

# Galaxy Debug

## Order of investigation

1. `pnpm test` in `@galaxy/rules`
2. Reproduce with `harness/scenarios/*.json`
3. MCP: `game_get_state` + `game_get_event_log` (JSON, not screenshots)
4. ASCII mismatch → bug in `packages/rules/src/observation/`
5. UI bugs → cursor-ide-browser MCP, not game MCP

## Common traps

- Hex distance uses axial coords; corner-touching cells are NOT neighbors
- Max 4 ships per cell
- Power Center marker ≠ credit token
