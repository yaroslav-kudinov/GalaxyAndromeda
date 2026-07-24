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

Region size sets **minimum** cell count per ship class (see `ships.yaml` → `productionRegionSize[0]`; larger regions are fine). Face-up tokens in the marker's controlled region pay for builds; spent tokens flip face-down (server auto-allocates).

When the region has **both** face-up and face-down **production** tokens, resolving the marker is either **Recharge** (flip face-down production tokens face-up) **or** **Build** (batch ship production) — not both in the same marker turn.

Batch build: choose how many ships of each class, place each ship on any hex in the region (capacity limits apply), one marker per turn.

### Planning markers

- **Action markers:** up to 6 per player, 1 per hex; used in Actions phase.
- **Production markers:** **1 per controlled region** (place on any hex of that region); marks where you will build in Production phase. Region size determines ship class limits.

## Turn order

Phases: Events → Planning → Actions → Production.

Fewer regions acts first in Actions/Production.
