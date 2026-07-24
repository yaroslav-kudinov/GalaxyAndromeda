---
name: galaxy-map-editor
description: Edit maps in creative mode. Use for MapDefinition, /editor, import/export JSON.
---

# Galaxy Map Editor

## Format

See [docs/map-format.md](../../docs/map-format.md).

## UI

- Route: `/editor` (Nuxt)
- Ghost slots: click `+` on dashed hex edges to add cells
- Property panel: Power Center ★, credit/production tokens 1–9

## Storage

- localStorage key: `galaxy-maps`
- Export/import `.json` files compatible with `@galaxy/rules`
