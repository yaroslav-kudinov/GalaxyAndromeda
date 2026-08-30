# Agent protocol

HTTP base: `http://127.0.0.1:3001` (env `GAME_SERVER_URL` for MCP).

## REST

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/bug-reports` | Body: `{ description, screenshotBase64?, screenshotMime?, roomId?, playerId?, playerName? }` → `{ ok, id, expiresAt, hasScreenshot }`. Хранение в `.bug-reports/`, TTL 60 дней |
| POST | `/rooms` | Body: `{ map, maxPlayers? }` or `{ save, maxPlayers? }` → `{ roomId, code }`. Комната в статусе `lobby` |
| POST | `/rooms/:id/join` | Body: `{ playerName, preferredPlayerId? }` → `{ playerId, code }`. Только пока `lobby` |
| POST | `/rooms/:id/rejoin` | Body: `{ playerId, playerName?, preferredPlayerId? }` → смена слота в лобби или возврат в свой слот |
| POST | `/rooms/:id/start` | Body: `{ playerId }` — хост начинает партию (`playing`) |
| POST | `/rooms/:id/close` | Body: `{ playerId }` — хост закрывает комнату подготовки (до старта) |
| GET | `/rooms/:id/bootstrap` | Карта, слоты, `status`, `hostPlayerId`, `joinedPlayerIds` |
| GET | `/rooms/:id/state?playerId=` | `GameObservation` |
| GET | `/rooms/:id/legal-actions?playerId=` | `LegalAction[]` |
| POST | `/rooms/:id/action` | Body: `{ playerId, action: { actionId, params? } }` |
| GET | `/rooms/:id/events` | Last 20 `GameEvent` |

### Combat actions

| actionId | params | Description |
|----------|--------|-------------|
| `execute-marker-movement` | `{ from, moves, combatOptions? }` | `combatOptions.attacker/defender.prioritySkips`: `{ shipType }[]`; optional `destructionSelection` |
| `execute-marker-bombardment` | `{ from, bombardments, combatOptions? }` | Same combat options |
| `continue-combat` | `{ combatOptions? }` | Решение продолжать: сначала attacker, затем defender; после двух подтверждений — следующий раунд |
| `stop-combat` | `{ retreatTo: { q, r } }` | Текущий решающий участник отступает в соседнюю клетку без вражеских кораблей (сначала attacker, затем defender; кроме «Стоять насмерть!») |
| `confirm-combat-destruction` | `{ destructionSelection: string[] }` | Winner confirms ship IDs to destroy after round |
| `update-combat-prep` | `{ ready: boolean, prioritySkips?: { shipType }[], supportSide?: 'attacker' \| 'defender' }` | Участники объявляют skip + ready; неучастник с доступной поддержкой выбирает `supportSide` без ready |
| `cancel-combat-prep` | — | Attacker cancels prep before battle starts |
| `abort-combat` | — | Participant aborts a stuck combat; pending movement is finalized |
| `surrender` | — | Сдаться в любой момент: `eliminated`, контроль и маркеры сняты, корабли остаются |
| `execute-production` | `{ markerId, ships, spentTokens? }` | Постройка в регионе; `ships` не пустой |
| `execute-buy-production-marker` | `{ spentTokens }` | Покупка доп. маркера производства (не больше одного за игровой ход): фишки снимаются с карты; не исполняет маркер на карте |

Without `combatOptions`, movement/bombardment into combat enters `pendingCombat` with `phase: 'prep'`. Movement: mutual ready → countdown 3s → auto-resolve. Bombardment: attacker-only ready → countdown; multiple targets queued via `queuedBombardmentPlans`. Sync via `GET /state` polling.

Combat FSM phases: `prep` → (roll) → `awaiting-destruction` (winner picks losses) → `awaiting-continue` (attacker then defender decide continue/retreat). Invalid `pendingCombat` is released automatically by the server.

## GameObservation

```typescript
{
  mechanics: {
    phase, turnNumber, activePlayerId, players, cells,
    pendingCombat?, turnEvent?, gameOver?, lastCombatResult?,
    observationRevision?, // monotonic; clients ignore stale responses
    roomStatus?, // 'lobby' | 'playing'
    hostPlayerId?,
    actionMarkerLimitByPlayer?, // 2 + центры власти, заморожено в начале хода
    productionMarkerLimitByPlayer?, // купленный пул PM (старт 1, макс 3)
    productionMarkerBoughtByPlayerThisTurn?, // кто уже купил доп. PM в этом игровом ходе
    // cleared fields are sent as explicit null, not omitted
  },
  geometry: {
    asciiMap: string,
    spatialSummary: { regions, powerCenters, supplyChains, distances },
    reachableHexes?: string[]
  },
  legalActions: LegalAction[]
}
```

**Sync contract:** server is source of truth. `observationRevision` increments on each state change (actions, combat auto-resolve). `pendingCombat`, `turnEvent`, `gameOver`, `lastCombatResult` use **explicit `null`** when cleared — clients must not preserve local values when server sends `null`. `lastCombatResult` is cached until the next non-prep action so both players can poll the same round result.

Карта события хода вытягивается и применяется **автоматически** при выходе из производства (фаза `events` не интерактивна). Действие `resolve-event` оставлено для старых клиентов и сразу уводит в планирование; в `legalActions` его больше не нужно выбирать.

## ASCII legend

- `B/G/R` — player control initial
- `:xx` — ship type prefix
- `★` — Power Center
- `Yn` — credits token value n
- `On` — production token value n

## MCP tools

- `game_ping`
- `game_create_room`, `game_join_room`, `game_start_room`
- `game_get_state`, `game_get_legal_actions`, `game_submit_action`
- `game_get_event_log`, `game_add_ai_player`

## WebSocket

`WS /ws` — echo stub; full sync in server-game worktree.
