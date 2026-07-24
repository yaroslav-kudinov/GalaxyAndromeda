# Galaxy Andromeda — Rulebook (stub)

Structured from PDF. Full text to be expanded in `agent/docs-data` worktree.

## TOC

1. [Victory conditions](#victory-conditions)
2. [Map and control](#map-and-control)
3. [Ships](#ships)
4. [Combat and bombardment](#combat)
5. [Production](#production)
6. [Turn order](#turn-order)

## Victory conditions

1. Control 4 regions of 7+ cells each
2. Control majority of Power Centers
3. Last player on map

Defeat: lose all Power Center cells.

## Map and control

- Hex grid, face-adjacent only
- Regions = connected controlled cells
- Resources: Credits (yellow tokens 1–9), Production (orange tokens 1–9)
- Power Center = small yellow dot marker (separate from credit tokens)
- Supply chains link regions for production

## Ships

See `packages/rules/data/ships.yaml` for stats.

Types: destroyer, cruiser, battleship, shield, hyper, supply.

## Combat

Round: priority skip → dice → winner → destruction by priority tiers.

## Production

Region size gates ship types. Tokens flipped after use.

## Turn order

Phases: Events → Planning → Actions → Production.

Fewer regions acts first in Actions/Production.
