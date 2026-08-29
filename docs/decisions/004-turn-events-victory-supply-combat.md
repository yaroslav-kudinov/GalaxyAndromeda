# ADR 004: Turn events, victory, supply chains, multi-round combat

## Status

Accepted

## Context

Galaxy Andromeda requires global turn events, victory/defeat detection, supply-chain production validation, and multi-round combat state in `GameSnapshot`. These extend the runtime save contract beyond core `GameState` in `types.ts`.

## Decision

Extend `GameSnapshot` (in `save-file.ts`, not `types.ts`) with:

### `turnEvent`

```typescript
turnEvent?: {
  cardId: string
  turnNumber: number
  title: string
  message: string
  resolvedAt?: string
}
```

Drawn when entering the events phase after production. Immediate effects (mandatory-overtime) apply on resolve. Modifiers apply for the rest of the turn via `getTurnModifiers(game)`.

### `gameOver`

```typescript
gameOver?: {
  winnerId: string
  reason: 'four_regions' | 'power_centers' | 'last_standing'
}
```

Set by `applyVictoryAndDefeatChecks` after control changes, combat, and production phase advance. Server blocks further actions when present.

### `pendingCombat`

```typescript
pendingCombat?: {
  cellKey: string
  attackerId: string
  defenderIds: string[]
  roundNumber: number
  awaitingContinue: boolean
  trigger?: 'movement' | 'stack' | 'bombardment'
}
```

After one combat round, if enemies remain on the hex, combat pauses until attacker chooses `continue-combat` or `stop-combat`. Retreat blocked when event `stand_to_death` is active.

### Supply chain validation

Production token payment is limited to face-adjacent controlled cells in the same connected component as the marker's region (`supply-chains.ts`). `spatialSummary.supplyChains` lists per-player connected components for agents/UI.

## Consequences

- `@galaxy/rules`: `events.ts`, `victory.ts`, `supply-chains.ts`, combat/movement/production integrations
- `@galaxy/server`: block actions when `gameOver` is set
- `@galaxy/client`: EventCardPanel, game-over overlay, supply-chain highlight, continue/stop combat banner
- `docs/rulebook.md`: full event catalog and victory/supply/combat rules
