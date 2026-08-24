---
name: galaxy-play
description: Play or simulate Galaxy Andromeda via MCP. Use when an agent joins a game or chooses actions.
---

# Galaxy Play

## Observation

Read **`geometry.asciiMap` and `spatialSummary` first** for strategy, then `mechanics` for numbers, then `legalActions`.

## MCP flow

1. `game_ping`
2. `game_create_room` or join existing
3. `game_join_room` (optional `preferredPlayerId` = слот/цвет)
4. Host: `game_start_room` (`roomId`, `playerId`) — иначе действия отклоняются
5. Loop: `game_get_state` → pick from `legalActions` → `game_submit_action`

## Response format

```json
{ "actionId": "...", "params": {} }
```

Only choose IDs from `legalActions`.
