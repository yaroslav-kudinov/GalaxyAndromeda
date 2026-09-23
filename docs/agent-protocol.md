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
| `execute-marker-movement` | `{ from, moves, combatOptions? }` | `combatOptions.attacker/defender`: `targetPriority?: string[]` (id вражеских кораблей в порядке фокуса), `diceTargets?: Record<shooterId, targetId[]>` (явная цель каждого кубика); без них кубики распределяются автоматически |
| `execute-marker-bombardment` | `{ from, bombardments, combatOptions? }` | Same combat options |
| `continue-combat` | `{ diceTargets?: Record<shooterId, targetId[]> }` | Цели на следующий раунд и «продолжить». Пока никто не уничтожен — attacker и defender в любом порядке; после первого уничтожения defender после attacker. Поддерживающий третий игрок тоже подтверждает (`pendingCombat.supportReady`). Раунд бросается, когда решили все; неназначенные кубики раздаёт игра, чужие назначения в наблюдении скрыты (ADR 018) |
| `stop-combat` | `{ retreatTo: { q, r } }` | Текущий решающий участник отступает в соседнюю клетку без вражеских кораблей (сначала attacker, затем defender) |
| `update-combat-prep` | `{ ready: boolean, targetPriority?: string[], diceTargets?: Record<shooterId, targetId[]>, supportSide?: 'attacker' \| 'defender' \| null }` | Участники объявляют цели первого раунда + ready; неучастник с доступной поддержкой выбирает `supportSide` (с `ready: false`), затем цели и `ready: true`; `supportSide: null` с `ready: true` — «не поддерживать». При `prep.assaultBlocked` атакующему штурм недоступен — только `establish-siege` или отмена |
| `cancel-combat-prep` | — | Attacker cancels prep before battle starts; для `prep.siegeResponse` — отказ осаждённого нападать |
| `choose-doctrine` | `{ doctrineId }` | Планирование, первый ход окна доктрин (`doctrineChoice` открыт): `expansion`, `production`, `maneuvers`, `attack`, `defense`, `none`. Любой участник, вне очереди. Чужие выборы в наблюдении скрыты (`doctrineChoice.pickedBy` — кто уже выбрал); вскрытие, когда выбрали все (ADR 020) |
| `establish-siege` | — | Атакующий в подготовке боя (`prep.siegeAvailable`) осаждает центр власти вместо штурма: корабли входят без боя, маркер исполнен (ADR 019) |
| `execute-marker-assault` | `{ from, combatOptions? }` | Бой на клетке маркера с чужими кораблями без перемещения: вылазка гарнизона или штурм осаждающих |
| `execute-siege-losses` | `{ shipIds? }` | Планирование: какой корабль каждого осаждённого гарнизона потерять (по одному на клетку из `siegeLossesOwedByPlayer`); без `shipIds` — самые дешёвые |
| `abort-combat` | — | Participant aborts a stuck combat; pending movement is finalized |
| `surrender` | — | Сдаться в любой момент: `eliminated`, контроль и маркеры сняты, корабли остаются |
| `execute-production` | `{ markerId, ships, spentTokens? }` | Постройка в регионе; `ships` не пустой. `spentTokens` — явный выбор фишек оплаты (`{ coord, tokenIndex }[]`, только лицом вверх и в регионе маркера); без него фишки подбираются автоматически от крупных к мелким |
| `execute-buy-production-marker` | `{ spentTokens }` | Покупка доп. маркера производства (не больше одного за игровой ход): фишки снимаются с карты; не исполняет маркер на карте |

Without `combatOptions`, movement/bombardment into combat enters `pendingCombat` with `phase: 'prep'`. Movement: mutual ready → countdown 3s → auto-resolve. Bombardment: attacker-only ready → countdown; multiple targets queued via `queuedBombardmentPlans`. Sync via `GET /state` polling.

Combat FSM phases: `prep` → (rounds) → `awaiting-continue` (attacker then defender decide continue/retreat). Бой на попаданиях (ADR 018): каждый раунд обе стороны бросают d6 по порогу класса, попадания применяются одновременно; урон копится в `pendingCombat.damageByShipId` до конца боя, последний раунд лежит в `pendingCombat.lastRound`. Пока в бою никто не уничтожен, раунды бросаются сами. Бой, в котором ни одна сторона не может стрелять, не состоится (`combatResult.stalemate`). Invalid `pendingCombat` is released automatically by the server.

## GameObservation

```typescript
{
  mechanics: {
    phase, turnNumber, activePlayerId, players, cells,
    pendingCombat?, doctrineChoice?, doctrineByPlayer?, gameOver?, lastCombatResult?,
    observationRevision?, // monotonic; clients ignore stale responses
    roomStatus?, // 'lobby' | 'playing'
    hostPlayerId?,
    actionMarkerLimitByPlayer?, // всегда 6 (ADR 015)
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

**Sync contract:** server is source of truth. `observationRevision` increments on each state change (actions, combat auto-resolve). `pendingCombat`, `doctrineChoice`, `gameOver`, `lastCombatResult` use **explicit `null`** when cleared — clients must not preserve local values when server sends `null`. `lastCombatResult` is cached until the next non-prep action so both players can poll the same round result.

Цикл хода — две фазы: `planning` → `actions` (ADR 020). Колоды событий и фазы `events` больше нет; сохранение, застрявшее в `events`, при первом чтении переводится в планирование. В начале планирования: тик осады, в первый ход окна доктрин — выбор доктрины (`choose-doctrine`), затем долги захвата и перезарядки.

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

## Room chat

| Method | Path | Description |
|--------|------|-------------|
| GET | `/rooms/:id/chat?playerId=&after=` | Сообщения, видимые игроку (общий канал + личные с его участием). `after` — id последнего известного сообщения |
| POST | `/rooms/:id/chat` | Body: `{ playerId, text, toPlayerId? }` → `{ message }`. Без `toPlayerId` — общий чат. Лимиты: 400 символов, 12 сообщ./мин |

См. [ADR 014](./decisions/014-room-chat.md).
