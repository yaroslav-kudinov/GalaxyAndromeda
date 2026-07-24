# Agent protocol

HTTP base: `http://127.0.0.1:3001` (env `GAME_SERVER_URL` for MCP).

## REST

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/rooms` | Body: `{ map, maxPlayers? }` → `{ roomId, code }` |
| POST | `/rooms/:id/join` | Body: `{ playerName }` → `{ playerId, code }` |
| GET | `/rooms/:id/state?playerId=` | `GameObservation` |
| GET | `/rooms/:id/legal-actions?playerId=` | `LegalAction[]` |
| POST | `/rooms/:id/action` | Body: `{ playerId, action: { actionId, params? } }` |
| GET | `/rooms/:id/events` | Last 20 `GameEvent` |

## GameObservation

```typescript
{
  mechanics: { phase, turnNumber, activePlayerId, players, cells },
  geometry: {
    asciiMap: string,
    spatialSummary: { regions, powerCenters, supplyChains, distances },
    reachableHexes?: string[]
  },
  legalActions: LegalAction[]
}
```

## ASCII legend

- `B/G/R` — player control initial
- `:xx` — ship type prefix
- `★` — Power Center
- `Yn` — credits token value n
- `On` — production token value n

## MCP tools

- `game_ping`
- `game_create_room`, `game_join_room`
- `game_get_state`, `game_get_legal_actions`, `game_submit_action`
- `game_get_event_log`, `game_add_ai_player`

## WebSocket

`WS /ws` — echo stub; full sync in server-game worktree.
