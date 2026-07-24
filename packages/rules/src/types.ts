/** Shared game contracts — change only via ADR in docs/decisions/ */

export type Phase = 'events' | 'planning' | 'actions' | 'production'

export type ResourceTokenType = 'credits' | 'production'

export type ResourceTokenValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export interface ResourceTokenDef {
  type: ResourceTokenType
  value: ResourceTokenValue
  faceUp?: boolean
}

/** Starting ship on map setup (editor / MapDefinition) */
export interface StartingShipDef {
  type: ShipType
  /** Player slot 1–6 */
  player: number
}

export interface MapCellDefinition {
  q: number
  r: number
  isPowerCenter?: boolean
  /** One token per cell: credits OR production, value 1–9 */
  resourceToken?: ResourceTokenDef
  /** @deprecated use resourceToken — normalized on load */
  resourceTokens?: ResourceTokenDef[]
  /** Player slot 1–6 controls this cell at game start */
  startPlayer?: number | null
  /** Starting ships on this cell (max 4 per player, 8 total) */
  startingShips?: StartingShipDef[]
}

export interface MapDefinition {
  id: string
  name: string
  cells: MapCellDefinition[]
}

export type ShipType =
  | 'destroyer'
  | 'cruiser'
  | 'battleship'
  | 'shield'
  | 'hyper'
  | 'supply'

export interface HexCoord {
  q: number
  r: number
}

export interface ShipUnit {
  id: string
  type: ShipType
  ownerId: string
}

export interface CellState {
  coord: HexCoord
  isPowerCenter: boolean
  controlOwnerId: string | null
  resourceTokens: ResourceTokenDef[]
  ships: ShipUnit[]
}

export interface PlayerState {
  id: string
  name: string
  color: string
  isAi: boolean
  eliminated: boolean
}

export interface GameState {
  mapId: string
  phase: Phase
  turnNumber: number
  activePlayerId: string | null
  players: PlayerState[]
  cells: CellState[]
  eventLog: GameEvent[]
}

export interface GameEvent {
  id: string
  turn: number
  phase: Phase
  type: string
  message: string
  timestamp: number
}

export interface LegalAction {
  id: string
  type: string
  description: string
  params?: Record<string, unknown>
}

export interface SpatialRegion {
  id: string
  ownerId: string | null
  size: number
  hexes: string[]
}

export interface SpatialSummary {
  regions: SpatialRegion[]
  powerCenters: { q: number; r: number; ownerId: string | null }[]
  supplyChains: { playerId: string; path: string[] }[]
  distances: { from: string; to: string; steps: number }[]
}

export interface GameObservation {
  mechanics: {
    phase: Phase
    turnNumber: number
    activePlayerId: string | null
    players: PlayerState[]
    cells: CellState[]
  }
  geometry: {
    asciiMap: string
    spatialSummary: SpatialSummary
    reachableHexes?: string[]
  }
  legalActions: LegalAction[]
}

export interface ActionPayload {
  actionId: string
  params?: Record<string, unknown>
}

export function hexKey(q: number, r: number): string {
  return `${q},${r}`
}

export function parseHexKey(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number)
  return { q, r }
}
