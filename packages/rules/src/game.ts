import { getCellResourceToken } from './map-editor.js'
import { resolveMapPlayerCount } from './map-editor.js'
import type { GameObservation, GameState, LegalAction, MapDefinition } from './types.js'
import { getActiveEventObservation } from './events.js'
import type { GameSnapshot } from './save-file.js'
import { buildSpatialSummary, renderAsciiMap } from './observation/index.js'
import { PLAYER_COLORS } from './constants.js'
import { advanceGamePhase, phaseAdvanceActionLabel } from './turn.js'

const EMPTY_GEOMETRY: GameObservation['geometry'] = {
  asciiMap: '',
  spatialSummary: { regions: [], powerCenters: [], supplyChains: [], distances: [] },
  reachableHexes: [],
}

export interface BuildObservationOptions {
  /** Full ASCII map + spatial summary for agents (default: true) */
  geometry?: boolean
}

export function gameStateFromMap(map: MapDefinition, playerNames: string[] = []): GameState {
  const slotCount = Math.max(resolveMapPlayerCount(map), playerNames.length)

  const players = Array.from({ length: slotCount }, (_, i) => ({
    id: `player-${i + 1}`,
    name: playerNames[i] ?? `Игрок ${i + 1}`,
    color: PLAYER_COLORS[i + 1] ?? '#888',
    isAi: false,
    eliminated: false,
  }))

  return {
    mapId: map.id,
    phase: 'planning',
    turnNumber: 1,
    activePlayerId: players[0]?.id ?? null,
    players,
    cells: map.cells.map((c) => {
      const token = getCellResourceToken(c)
      return {
        coord: { q: c.q, r: c.r },
        isPowerCenter: c.isPowerCenter ?? false,
        controlOwnerId: c.startPlayer != null ? `player-${c.startPlayer}` : null,
        resourceTokens: token ? [{ ...token, faceUp: token.faceUp ?? true }] : [],
        ships: (c.startingShips ?? []).map((s, idx) => ({
          id: `start-${c.q}-${c.r}-${idx}`,
          type: s.type,
          ownerId: `player-${s.player}`,
        })),
      }
    }),
    eventLog: [],
  }
}

export function buildObservation(
  state: GameState & {
    actionMarkers?: unknown[]
    productionMarkers?: unknown[]
    actionMarkerResolvedThisTurn?: boolean
    productionMarkerResolvedThisTurn?: boolean
  },
  legalActions: LegalAction[] = [],
  options: BuildObservationOptions = {},
): GameObservation {
  const includeGeometry = options.geometry !== false
  const mechanics: GameObservation['mechanics'] & Record<string, unknown> = {
    phase: state.phase,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
    players: state.players,
    cells: state.cells,
  }
  if (state.actionMarkers) mechanics.actionMarkers = state.actionMarkers
  if (state.productionMarkers) mechanics.productionMarkers = state.productionMarkers
  if (state.actionMarkerResolvedThisTurn != null) {
    mechanics.actionMarkerResolvedThisTurn = state.actionMarkerResolvedThisTurn
  }
  if (state.productionMarkerResolvedThisTurn != null) {
    mechanics.productionMarkerResolvedThisTurn = state.productionMarkerResolvedThisTurn
  }
  const stateExtra = state as unknown as Record<string, unknown>
  const mechanicsExtra = mechanics as Record<string, unknown>

  /** Явная передача полей snapshot — null означает «очищено на сервере» */
  for (const key of [
    'participatingPlayerIds',
    'turnEvent',
    'gameOver',
    'pendingCombat',
    'productionTokensSpentThisTurn',
    'overtimeRegionByPlayer',
    'eventLog',
    'lastCombatResult',
    'observationRevision',
  ] as const) {
    if (key in stateExtra) {
      mechanicsExtra[key] = stateExtra[key] ?? null
    }
  }

  if (Array.isArray(mechanicsExtra.participatingPlayerIds)) {
    mechanicsExtra.participatingPlayerIds = [...(mechanicsExtra.participatingPlayerIds as string[])]
  }

  const activeEvent = getActiveEventObservation(state as unknown as GameSnapshot)
  if (activeEvent) {
    mechanicsExtra.activeEvent = activeEvent
  }

  return {
    mechanics: mechanics as GameObservation['mechanics'],
    geometry: includeGeometry
      ? {
          asciiMap: renderAsciiMap(state),
          spatialSummary: buildSpatialSummary(state),
          reachableHexes: [],
        }
      : EMPTY_GEOMETRY,
    legalActions,
  }
}

export function getLegalActions(state: GameState, playerId: string): LegalAction[] {
  if (state.activePlayerId !== playerId) return []
  return [
    {
      id: 'advance-phase',
      type: 'advancePhase',
      description: phaseAdvanceActionLabel(state),
    },
  ]
}

export function applyGameAction(
  state: GameState,
  playerId: string,
  actionId: string,
  _params?: Record<string, unknown>,
): string[] {
  if (state.activePlayerId !== playerId) return ['Сейчас ход другого игрока']
  if (actionId === 'advance-phase') return advanceGamePhase(state)
  if (actionId === 'execute-marker-movement') {
    return ['Движение маркера требует полного снимка игры (GameSnapshot)']
  }
  return [`Неизвестное действие: ${actionId}`]
}
