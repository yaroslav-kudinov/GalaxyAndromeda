import type {
  CombatResolutionResult,
  PendingCombat,
  PlayerState,
  ShipType,
} from '@galaxy/rules'
import {
  combatRoundStateOf,
  parseHexKey,
} from '@galaxy/rules'
import { playerSlotFromId } from '~/utils/board-adapter'
import {
  indexShipsById,
  type BoardCellLike,
} from '~/utils/ship-move-index'

export interface CombatGhostView {
  id: string
  type: ShipType
  player: number
  q: number
  r: number
}

export interface CombatApproachMove {
  from: { q: number; r: number }
  to: { q: number; r: number }
  shipId: string
  combat: true
}

export function combatIncomingShipIds(
  pending: PendingCombat | null | undefined,
): string[] {
  if (!pending) return []
  if (pending.phase === 'prep') {
    return pending.prep.incomingAttackerShipIds ?? []
  }
  return (
    pending.continuation?.incomingAttackerShipIds
    ?? pending.roundState?.incomingAttackerShipIds
    ?? []
  )
}

function combatCellCoord(pending: PendingCombat): { q: number; r: number } {
  return parseHexKey(pending.cellKey)
}

function originForIncoming(pending: PendingCombat): { q: number; r: number } | null {
  if (pending.continuation?.movementFrom) return pending.continuation.movementFrom
  if (pending.phase === 'prep' && pending.prep.movementFrom) return pending.prep.movementFrom
  const rs = combatRoundStateOf(pending)
  if (rs?.movementFrom) return rs.movementFrom
  return null
}

/**
 * Стрелки «куда идут атакующие», только пока сервер ещё держит их на исходной клетке.
 * Если снимок уже перенёс корабль — стрелку не рисуем (полёт глифа сам дотянет).
 */
export function combatIncomingApproachMoves(args: {
  pending: PendingCombat | null | undefined
  cells: BoardCellLike[]
}): CombatApproachMove[] {
  const pending = args.pending
  if (!pending) return []
  const origin = originForIncoming(pending)
  if (!origin) return []
  const dest = combatCellCoord(pending)
  const incoming = combatIncomingShipIds(pending)
  if (!incoming.length) return []
  const index = indexShipsById(args.cells)
  const moves: CombatApproachMove[] = []
  for (const id of incoming) {
    const ship = index.get(id)
    if (!ship) continue
    if (ship.q !== origin.q || ship.r !== origin.r) continue
    moves.push({
      from: origin,
      to: dest,
      shipId: id,
      combat: true,
    })
  }
  return moves
}

function rollLookup(result: CombatResolutionResult): Map<
  string,
  { type: ShipType; ownerId: string; side: 'attacker' | 'defender' }
> {
  const map = new Map<string, { type: ShipType; ownerId: string; side: 'attacker' | 'defender' }>()
  const rounds = result.rounds?.length ? result.rounds : result.roundOne ? [result.roundOne] : []
  for (const round of rounds) {
    for (const roll of round.shipRolls ?? []) {
      map.set(roll.shipId, {
        type: roll.shipType,
        ownerId: roll.ownerId,
        side: roll.side,
      })
    }
  }
  return map
}

/**
 * Призраки уничтоженных в этом раунде. Не подменяют снимок: только id из lastCombatResult,
 * которых уже нет на карте.
 */
export function combatDestroyedGhosts(args: {
  result: CombatResolutionResult | null | undefined
  pending: PendingCombat | null | undefined
  players: PlayerState[]
  cells: BoardCellLike[]
}): CombatGhostView[] {
  const result = args.result
  if (!result?.destroyedShipIds.length) return []
  const stillOnBoard = indexShipsById(args.cells)
  const rolls = rollLookup(result)
  const incoming = new Set(combatIncomingShipIds(args.pending))
  const origin = args.pending ? originForIncoming(args.pending) : null
  const combatHex = result.coord
  const ghosts: CombatGhostView[] = []
  for (const id of result.destroyedShipIds) {
    if (stillOnBoard.has(id)) continue
    const meta = rolls.get(id)
    const atOrigin = Boolean(origin && (incoming.has(id) || meta?.side === 'attacker'))
    const q = atOrigin && origin ? origin.q : combatHex.q
    const r = atOrigin && origin ? origin.r : combatHex.r
    const ownerId = meta?.ownerId ?? null
    ghosts.push({
      id,
      type: meta?.type ?? 'destroyer',
      player: playerSlotFromId(args.players, ownerId) ?? 1,
      q,
      r,
    })
  }
  return ghosts
}

export function combatPulseHexKey(
  pending: PendingCombat | null | undefined,
): string | null {
  return pending?.cellKey ?? null
}
