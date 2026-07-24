# Map format (MapDefinition)

Axial hex coordinates `(q, r)`, flat-top layout.

```json
{
  "id": "my-map",
  "name": "My Map",
  "cells": [
    {
      "q": 0,
      "r": 0,
      "isPowerCenter": true,
      "resourceTokens": [
        { "type": "credits", "value": 5 },
        { "type": "production", "value": 3 }
      ],
      "startPlayer": 1
    }
  ]
}
```

## Tokens

- **credits** — yellow pips, value 1–9
- **production** — orange pips, value 1–9
- **Power Center** — `isPowerCenter: true` (small yellow dot in UI, not a resource token)

## Editor

Nuxt `/editor` — ghost slots to add cells, property panel, localStorage + JSON export.

## Validation

`validateMapDefinition()` in `@galaxy/rules` — no duplicate coords, valid token values.
