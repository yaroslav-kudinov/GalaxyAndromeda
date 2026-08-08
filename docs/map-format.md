# Map format (MapDefinition)

Axial hex coordinates `(q, r)`, flat-top layout.

```json
{
  "id": "my-map",
  "name": "My Map",
  "playerCount": 4,
  "cells": [
    {
      "q": 0,
      "r": 0,
      "isPowerCenter": true,
      "resourceToken": { "type": "credits", "value": 5, "faceUp": true },
      "startPlayer": 1,
      "startingShips": [
        { "type": "supply", "player": 1 },
        { "type": "destroyer", "player": 1 }
      ]
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique map identifier |
| `name` | Display name |
| `playerCount` | Optional intended player count **1–6** (`MAX_LOBBY_PLAYERS`). Independent of editor symmetry mode. If omitted, inferred from `startPlayer` / `startingShips` slots (default **2** when none) |
| `cells` | Hex cell definitions |

## Fields per cell

| Field | Description |
|-------|-------------|
| `q`, `r` | Axial coordinates |
| `isPowerCenter` | Power Center marker (yellow dot in UI, separate from resource tokens) |
| `resourceToken` | **One** token per cell: `credits` or `production`, value **1–9** |
| `startPlayer` | Player slot **1–6** that controls the cell at game start (hex fill color) |
| `startingShips` | Up to **4 ships per player**, **8 total** per hex: `{ type, player }` |

## Tokens

- **credits** — yellow pips, value 1–9
- **production** — orange pips, value 1–9
- A cell cannot have both credits and production tokens

## Ships (`startingShips`)

Types: `supply`, `destroyer`, `cruiser`, `battleship`, `shield`, `hyper`.  
Max **4 ships per player** and **8 total** in one hex (e.g. two players in battle).

## Legacy

Older maps may use `resourceTokens` (array). The editor and `normalizeMapDefinition()` convert to single `resourceToken`.

## Bundled maps

- `maps/default.json` — minimal dev stub
- `maps/duel-2p.json` — compact symmetric 2-player duel
- `maps/tts-reference.json` — approximate 3-player layout from TTS screenshot (`docs/visual-reference.png`)

## Validation

`validateMapDefinition()` in `@galaxy/rules` — no duplicate coords, one token per cell, valid values, player slots 1–6, max 4 ships per player and 8 total per cell.
