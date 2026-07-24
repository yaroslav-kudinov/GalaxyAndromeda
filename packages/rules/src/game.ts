import type { GameObservation, GameState, LegalAction, MapDefinition } from './types.js'
import { buildSpatialSummary, renderAsciiMap } from './observation/index.js'

export function gameStateFromMap(map: MapDefinition, playerNames: string[] = []): GameState {
  const players = playerNames.map((name, i) => ({
    id: `player-${i + 1}`,
    name,
    color: ['#3B82F6', '#22C55E', '#EF4444', '#A855F7', '#F59E0B', '#06B6D4'][i] ?? '#888',
    isAi: false,
    eliminated: false,
  }))

  return {
    mapId: map.id,
    phase: 'planning',
    turnNumber: 1,
    activePlayerId: players[0]?.id ?? null,
    players,
    cells: map.cells.map((c) => ({
      coord: { q: c.q, r: c.r },
      isPowerCenter: c.isPowerCenter ?? false,
      controlOwnerId: c.startPlayer != null ? `player-${c.startPlayer}` : null,
      resourceTokens: (c.resourceTokens ?? []).map((t) => ({ ...t, faceUp: t.faceUp ?? true })),
      ships: [],
    })),
    eventLog: [],
  }
}

export function buildObservation(state: GameState, legalActions: LegalAction[] = []): GameObservation {
  return {
    mechanics: {
      phase: state.phase,
      turnNumber: state.turnNumber,
      activePlayerId: state.activePlayerId,
      players: state.players,
      cells: state.cells,
    },
    geometry: {
      asciiMap: renderAsciiMap(state),
      spatialSummary: buildSpatialSummary(state),
      reachableHexes: [],
    },
    legalActions,
  }
}

export function getLegalActions(_state: GameState, _playerId: string): LegalAction[] {
  return [
    {
      id: 'noop-1',
      type: 'noop',
      description: 'Placeholder action (gameplay not implemented yet)',
    },
  ]
}
