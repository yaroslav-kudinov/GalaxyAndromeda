# Galaxy save format (`.galaxy.json`)

Unified save file for map editor and in-progress games.

## Envelope

```json
{
  "format": "galaxy-save",
  "version": 1,
  "savedAt": "2026-07-24T18:00:00.000Z",
  "map": { "id": "my-map", "name": "My Map", "cells": [] },
  "game": { }
}
```

| Field | Description |
|-------|-------------|
| `format` | Always `"galaxy-save"` |
| `version` | Schema version (`1`) |
| `savedAt` | ISO-8601 timestamp |
| `map` | [MapDefinition](map-format.md) — board layout |
| `game` | Optional runtime snapshot; omitted for map-only saves |

## Legacy import

Plain `MapDefinition` JSON (no `format` field) is accepted on import and wrapped as map-only save.

## Game snapshot (`game`)

| Field | Description |
|-------|-------------|
| `phase` | `events` \| `planning` \| `actions` \| `production` |
| `turnNumber` | Current turn (≥ 1) |
| `activePlayerId` | Player id or `null` |
| `players` | `PlayerState[]` |
| `cells` | `RuntimeCellState[]` — control, ships, tokens, marker refs |
| `eventLog` | Resolved/historical `GameEvent[]` |
| `pendingEvents` | Placeholder queue for Events phase |
| `actionMarkers` | Planning/Actions markers (max **6 per player**, **1 per cell**) |
| `productionMarkers` | 1 per **region** per player (1 per hex max); applies to whole region |

### Runtime cell

Extends `CellState` with optional refs:

- `actionMarkerId` — at most one action marker per hex
- `productionMarkerId` — at most one production marker per hex

### Action marker

```json
{
  "id": "act-1",
  "ownerId": "player-1",
  "coord": { "q": 0, "r": 0 },
  "placedInPhase": "planning"
}
```

### Production marker

```json
{
  "id": "prod-1",
  "ownerId": "player-1",
  "coord": { "q": 2, "r": 0 },
  "targetRegionId": "region-0"
}
```

`targetRegionId` is the connected component of cells controlled by `ownerId` containing `coord` (same flood-fill as observation `SpatialRegion`). Production uses region **size** as a **minimum** per ship class (`ships.yaml` → `productionRegionSize[0]`).

### Pending event (placeholder)

```json
{
  "id": "evt-pending-1",
  "type": "stub",
  "message": "Future event",
  "resolved": false
}
```

## API (`@galaxy/rules`)

- `parseGalaxySave(raw)` — galaxy-save or legacy map JSON
- `serializeGalaxySave(save, pretty?)`
- `galaxySaveFromMap(map)` / `galaxySaveFromGameState(map, state)`
- `validateGalaxySave(save)`
- `isMapOnlySave(save)`
- `resolveRegionIdForCell(state, coord, ownerId)`

## Validation limits

- `MAX_ACTION_MARKERS_PER_PLAYER = 6` (may change in future rules revision)
- Production markers: **at most one per controlled region** per player (same as region count limit)
- One action marker and one production marker per hex
- All game cells must exist on `map`
