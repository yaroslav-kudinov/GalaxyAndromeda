/**

 * Combat mechanics — sketch / MVP design.

 * See docs/combat-system-draft.md

 *

 * TODO: full multi-round resolution, bombardment, snapshot pendingCombats, ADR for types.

 */

import { SHIP_LABELS } from './constants.js'
import { buildBombardmentPreview } from './bombardment.js'
import { getTurnModifiers, canRetreatFromBattle } from './events.js'
import { hexDistance } from './map.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import type { PendingCombat } from './save-file.js'
import type { HexCoord, ShipType, ShipUnit } from './types.js'
import { hexKey } from './types.js'



/** Поглощение урона щитоносцем — ships.yaml */

export const SHIELD_ABSORB_SELF = 4

export const SHIELD_ABSORB_NEIGHBOR = 2



/** destroyCost по ships.yaml */

export const SHIP_DESTROY_COST: Record<ShipType, number> = {

  destroyer: 3,

  cruiser: 6,

  battleship: 9,

  shield: 4,

  hyper: 4,

  supply: 4,

}



/** combatDice по ships.yaml (отсутствует у shield/supply/hyper) */

export const SHIP_COMBAT_DICE: Partial<Record<ShipType, number>> = {

  destroyer: 1,

  cruiser: 2,

  battleship: 3,

}



/** supportDice по ships.yaml */

export const SHIP_SUPPORT_DICE: Partial<Record<ShipType, number>> = {

  cruiser: 1,

  battleship: 2,

  hyper: 3,

}



/** fireRange max по ships.yaml — дальность поддержки / обстрела (совместимость) */

export const SHIP_FIRE_RANGE: Partial<Record<ShipType, number>> = {

  cruiser: 1,

  battleship: 2,

  hyper: 3,

}

/** min/max fireRange; Г.О. [2,3] — не соседняя клетка */

export interface FireRangeBounds {

  min: number

  max: number

}

export const SHIP_FIRE_RANGE_BOUNDS: Partial<Record<ShipType, FireRangeBounds>> = {

  cruiser: { min: 1, max: 1 },

  battleship: { min: 1, max: 2 },

  hyper: { min: 2, max: 3 },

}

/** Надбавка к destroyCost за объявленный priority skip типа (PDF) */

export const PRIORITY_SKIP_DESTROY_SURCHARGE = 1



/** Порядок уничтожения — ships.yaml → destructionPriority */

export const DESTRUCTION_PRIORITY: ShipType[] = [

  'destroyer',

  'hyper',

  'shield',

  'cruiser',

  'battleship',

  'supply',

]



export type CombatTriggerKind = 'movement' | 'stack' | 'bombardment'



export interface CombatParticipant {

  shipId: string

  type: ShipType

  ownerId: string

  side: 'attacker' | 'defender'

}



/** Корабль, дающий supportDice с соседней/дальней клетки (не на гексе боя) */

export interface CombatSupportShip {

  shipId: string

  type: ShipType

  ownerId: string

  fromCoord: HexCoord

  supportDice: number

  distance: number

}

/** Игрок вне основных сторон, способный направить корабли поддержки. */
export interface CombatSupportCandidate {
  playerId: string
  ships: CombatSupportShip[]
}



export interface CombatSidePreview {

  playerId: string

  role: 'attacker' | 'defender'

  ships: CombatParticipant[]

  /** Корабли на гексе боя — только combatDice */

  combatDiceTotal: number

  /** Кубики поддержки с клеток в пределах fireRange */

  supportDiceTotal: number

  supportingShips: CombatSupportShip[]

}



export interface ShieldContribution {

  shipId: string

  ownerId: string

  absorbCapacity: number

  scope: 'self' | 'neighbor'

  fromCoord: HexCoord

}



export interface CombatPreview {

  coord: HexCoord

  coordKey: string

  trigger: CombatTriggerKind

  attackerId: string

  defenderId: string

  attacker: CombatSidePreview

  defender: CombatSidePreview

  shieldContributions: ShieldContribution[]

  shieldAbsorbTotal: number

  destructionOrder: ShipType[]

  supportCandidates?: CombatSupportCandidate[]

  notes: string[]

}



export interface DetectedCombat {

  id: string

  coord: HexCoord

  trigger: CombatTriggerKind

  attackerId: string

  defenderId: string

  attackerShipIds: string[]

}



export interface ShipSupportRoll {

  fromShipId: string

  rolls: number[]

}



/** Журнал бросков одного корабля в раунде */

export interface ShipCombatRollLog {

  shipId: string

  shipType: ShipType

  ownerId: string

  side: 'attacker' | 'defender'

  /** Боевые кубики (корабль на гексе боя) */

  combatRolls: number[]

  /** Кубики поддержки (корабль вне гекса боя) */

  supportRolls?: ShipSupportRoll[]

  total: number

}



export interface CombatRoundResult {

  attackerTotal: number

  defenderTotal: number

  winner: 'attacker' | 'defender' | 'draw'

  shipRolls: ShipCombatRollLog[]

}



export interface BattleLogEntry {

  step: 'priority-skip' | 'dice-roll' | 'round-winner' | 'shield-absorb' | 'destruction'

  message: string

  data?: Record<string, unknown>

}



export interface CombatPrioritySkipPlan {
  /** Тип корабля — skip действует на все экземпляры этого типа на гексе боя */
  shipType: ShipType
}

export interface CombatSideOptions {
  /** Priority skip по типам кораблей этой стороны (один skip на тип, без оплаты) */
  prioritySkips?: CombatPrioritySkipPlan[]
  /** При равном tier — порядок уничтожения (shipId) */
  destructionTieBreak?: string[]
}

export interface CombatOptions {
  attacker?: CombatSideOptions
  defender?: CombatSideOptions
  /** Ручной выбор кораблей для уничтожения (победитель раунда) */
  destructionSelection?: string[]
  /** Неучастник выбирает сторону, которой помогают все его доступные корабли. */
  supportSides?: Record<string, 'attacker' | 'defender'>
}

/** Мультиплеерная подготовка к бою: priority skip + mutual ready + countdown */
export interface CombatPrepState {
  phase: 'prep' | 'countdown'
  defenderId: string
  readyBy: Record<string, boolean>
  combatOptions: CombatOptions
  countdownStartedAt?: number
  movementFrom?: HexCoord
  movementPlans?: import('./movement.js').ShipMovePlan[]
  bombardmentFrom?: HexCoord
  bombardmentPlans?: import('./bombardment.js').BombardmentPlan[]
  /** Оставшиеся цели обстрела после текущей клетки */
  queuedBombardmentPlans?: import('./bombardment.js').BombardmentPlan[]
  incomingAttackerShipIds?: string[]
}

export const COMBAT_PREP_COUNTDOWN_MS = 3000

export interface DestructionSelectionState {
  remainingDamage: number
  loserShipIds: string[]
  /** Фактическая цена каждого корабля с учётом событий и priority skip. */
  destroyCostByShipId: Record<string, number>
  /** Корабли первого доступного tier — уничтожаются первыми при авто-режиме */
  immediatelyDestroyableIds: string[]
  /** Все корабли, которые можно выбрать в рамках бюджета и приоритета */
  selectableIds: string[]
  /** Урон покрывает все корабли проигравшего — обязательное полное уничтожение */
  forceFullWipe: boolean
}

export interface CombatResolutionResult {
  coord: HexCoord
  winnerId: string | null
  /** Атакующий выиграл раунд (может войти на клетку) */
  attackerWon: boolean
  log: BattleLogEntry[]
  destroyedShipIds: string[]
  roundOne?: CombatRoundResult
  rounds?: CombatRoundResult[]
  shieldAbsorbed?: number
  rawDamage?: number
  /** Победитель должен выбрать корабли для уничтожения */
  needsDestructionSelection?: boolean
  destructionState?: DestructionSelectionState
  /** @deprecated always false after full combat implementation */
  stub: boolean
}



export interface ShipMoveCombatInput {

  shipId: string

  to: HexCoord

}



export const ONE_BATTLE_PER_MARKER_MSG =
  'В одном приказе маркера можно атаковать только одну клетку боя'



/** Уникальные ключи оспариваемых клеток среди планируемых ходов */

export function getCombatDestinationKeysFromMoves(

  game: GameSnapshot,

  moves: readonly ShipMoveCombatInput[],

  attackerId: string,

): string[] {

  const keys = new Set<string>()

  for (const move of moves) {

    if (isCombatDestination(game, attackerId, move.to)) {

      keys.add(hexKey(move.to.q, move.to.r))

    }

  }

  return [...keys]

}



export function validateSingleCombatDestination(

  game: GameSnapshot,

  moves: readonly ShipMoveCombatInput[],

  attackerId: string,

): string[] {

  if (getCombatDestinationKeysFromMoves(game, moves, attackerId).length > 1) {

    return [ONE_BATTLE_PER_MARKER_MSG]

  }

  return []

}



function cellAt(game: GameSnapshot, coord: HexCoord) {

  const key = hexKey(coord.q, coord.r)

  return game.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key)

}



function distinctOwners(ships: ShipUnit[]): string[] {

  return [...new Set(ships.map((s) => s.ownerId))]

}



export function getDestroyCost(type: ShipType): number {

  return SHIP_DESTROY_COST[type]

}



export function getSupportRange(type: ShipType): number {

  return getFireRangeBounds(type).max

}

export function getFireRangeBounds(type: ShipType): FireRangeBounds {
  const bounds = SHIP_FIRE_RANGE_BOUNDS[type]
  if (bounds) return bounds
  const max = SHIP_FIRE_RANGE[type] ?? 0
  return { min: max > 0 ? 1 : 0, max }
}

export function getEffectiveFireRangeBounds(game: GameSnapshot, type: ShipType): FireRangeBounds {
  const base = getFireRangeBounds(type)
  const mods = getTurnModifiers(game)
  if (type === 'hyper' && mods.hyperFireRange != null) {
    return { min: base.min, max: mods.hyperFireRange }
  }
  return base
}

export function getEffectiveSupportRange(game: GameSnapshot, type: ShipType): number {
  return getEffectiveFireRangeBounds(game, type).max
}



export function getEffectiveDestroyCost(game: GameSnapshot, type: ShipType): number {
  return SHIP_DESTROY_COST[type] + getTurnModifiers(game).destroyCostBonus
}

/** destroyCost с надбавкой priority skip (+1 за пропущенный тип) */
export function getDestroyCostWithPrioritySkip(
  type: ShipType,
  prioritySkipTypes: ReadonlySet<ShipType>,
  baseCost?: number,
): number {
  const base = baseCost ?? getDestroyCost(type)
  return base + (prioritySkipTypes.has(type) ? PRIORITY_SKIP_DESTROY_SURCHARGE : 0)
}

/** Rulebook example: shield absorbs 4 on cell + 2 from neighbor */

export function getShieldAbsorbCapacity(scope: 'self' | 'neighbor'): number {

  return scope === 'self' ? SHIELD_ABSORB_SELF : SHIELD_ABSORB_NEIGHBOR

}



/** Total absorb for one shield ship in given scope */

export function shieldAbsorbForShip(scope: 'self' | 'neighbor'): number {

  return getShieldAbsorbCapacity(scope)

}

/** Подпись щита для UI (на клетке — до 4, с соседа — до 2). */
export function formatShieldContributionLabel(contribution: ShieldContribution): string {
  const scopeHint = contribution.scope === 'self' ? 'на клетке' : 'с соседа'
  return `Щит: поглощает до ${contribution.absorbCapacity} (${scopeHint})`
}

/**
 * Стабильный ключ результата боя — для клиента: не перезапускать анимацию бросков
 * при повторной десериализации того же lastCombatResult с сервера.
 */
export function combatResolutionFingerprint(res: CombatResolutionResult | null | undefined): string | null {
  if (!res) return null
  const rollsKey =
    res.roundOne?.shipRolls
      .map((s) => `${s.shipId}:${s.total}:${s.combatRolls.join('.')}:${s.supportRolls?.map((x) => x.rolls.join('.')).join(',') ?? ''}`)
      .join('|') ?? ''
  return [
    res.coord.q,
    res.coord.r,
    res.attackerWon,
    res.needsDestructionSelection ?? false,
    res.destroyedShipIds.join(','),
    res.shieldAbsorbed ?? '',
    rollsKey,
  ].join(':')
}

/**

 * Rulebook 4+2 example: one self-shield + one neighbor-shield contributions.

 * @returns sum of absorb capacities

 */

export function totalShieldAbsorbExample(): number {

  return shieldAbsorbForShip('self') + shieldAbsorbForShip('neighbor')

}



export function destructionTierIndex(type: ShipType): number {

  const idx = DESTRUCTION_PRIORITY.indexOf(type)

  return idx >= 0 ? idx : DESTRUCTION_PRIORITY.length

}



export function compareDestructionPriority(a: ShipType, b: ShipType): number {

  return destructionTierIndex(a) - destructionTierIndex(b)

}



/** Клетка оспариваемая для атакующего игрока */

export function isCombatDestination(

  game: GameSnapshot,

  attackerId: string,

  dest: HexCoord,

): boolean {

  const cell = cellAt(game, dest)

  if (!cell) return false



  const enemyShips = cell.ships.some((s) => s.ownerId !== attackerId)

  const enemyControl =

    cell.controlOwnerId != null && cell.controlOwnerId !== attackerId



  return enemyShips || enemyControl

}



/** Гексы в радиусе хода, куда ведёт бой (вражеские), но не проходят обычную валидацию движения */

export function getCombatDestinationKeys(

  game: GameSnapshot,

  attackerId: string,

  candidateKeys: string[],

): string[] {

  return candidateKeys.filter((key) => {

    const [q, r] = key.split(',').map(Number)

    return isCombatDestination(game, attackerId, { q, r })

  })

}



function sumCombatDiceForShips(ships: ShipUnit[]): number {

  return ships.reduce((sum, s) => sum + (SHIP_COMBAT_DICE[s.type] ?? 0), 0)

}



function collectShieldContributions(

  game: GameSnapshot,

  battleCoord: HexCoord,

  defenderId: string,

): ShieldContribution[] {

  const out: ShieldContribution[] = []

  const battleKey = hexKey(battleCoord.q, battleCoord.r)



  for (const cell of game.cells) {

    const key = hexKey(cell.coord.q, cell.coord.r)

    const dist = hexDistance(battleCoord, cell.coord)

    if (dist > 1) continue



    for (const ship of cell.ships) {

      if (ship.type !== 'shield') continue

      if (ship.ownerId !== defenderId) continue



      const scope: 'self' | 'neighbor' = key === battleKey ? 'self' : 'neighbor'

      out.push({

        shipId: ship.id,

        ownerId: ship.ownerId,

        absorbCapacity: shieldAbsorbForShip(scope),

        scope,

        fromCoord: { ...cell.coord },

      })

    }

  }



  return out

}



/**

 * Корабли игрока вне гекса боя, дающие supportDice в пределах fireRange.

 * combatDice на гексе боя; supportDice — только с дистанции (ships.yaml / rulebook).

 */

export function collectSupportShips(
  game: GameSnapshot,
  battleCoord: HexCoord,
  playerId: string,
  battleHexShipIds: ReadonlySet<string> = new Set(),
): CombatSupportShip[] {

  const out: CombatSupportShip[] = []

  const battleKey = hexKey(battleCoord.q, battleCoord.r)



  for (const cell of game.cells) {

    const key = hexKey(cell.coord.q, cell.coord.r)

    if (key === battleKey) continue



    const dist = hexDistance(battleCoord, cell.coord)



    for (const ship of cell.ships) {

      if (ship.ownerId !== playerId) continue

      if (battleHexShipIds.has(ship.id)) continue



      const supportDice = SHIP_SUPPORT_DICE[ship.type] ?? 0
      const bounds = getEffectiveFireRangeBounds(game, ship.type)

      if (supportDice <= 0 || bounds.max <= 0) continue

      if (dist < bounds.min || dist > bounds.max) continue



      out.push({

        shipId: ship.id,

        type: ship.type,

        ownerId: ship.ownerId,

        fromCoord: { ...cell.coord },

        supportDice,

        distance: dist,

      })

    }

  }



  return out.sort((a, b) => a.distance - b.distance || a.shipId.localeCompare(b.shipId))

}



function inferDefenderId(

  cell: NonNullable<ReturnType<typeof cellAt>>,

  attackerId: string,

): string | null {

  const owners = distinctOwners(cell.ships.filter((s) => s.ownerId !== attackerId))

  if (owners.length === 1) return owners[0]

  if (cell.controlOwnerId && cell.controlOwnerId !== attackerId) {

    return cell.controlOwnerId

  }

  if (owners.length > 0) return owners[0]

  return null

}



function toParticipants(

  ships: ShipUnit[],

  side: 'attacker' | 'defender',

): CombatParticipant[] {

  return ships.map((s) => ({

    shipId: s.id,

    type: s.type,

    ownerId: s.ownerId,

    side,

  }))

}



function buildSidePreview(

  game: GameSnapshot,

  battleCoord: HexCoord,

  playerId: string,

  role: 'attacker' | 'defender',

  battleHexShips: ShipUnit[],

  assignedSupport: CombatSupportShip[] = [],

): CombatSidePreview {

  const battleHexShipIds = new Set(battleHexShips.map((s) => s.id))

  const supportingShips = [
    ...collectSupportShips(game, battleCoord, playerId, battleHexShipIds),
    ...assignedSupport,
  ]



  return {

    playerId,

    role,

    ships: toParticipants(battleHexShips, role),

    combatDiceTotal: sumCombatDiceForShips(battleHexShips),

    supportDiceTotal: supportingShips.reduce((sum, s) => sum + s.supportDice, 0),

    supportingShips,

  }

}



/**

 * Строит превью боя для UI до применения хода.

 * @param incomingAttackerShips — корабли, которые планируется переместить на клетку

 */

export function buildCombatPreview(

  game: GameSnapshot,

  coord: HexCoord,

  attackerId: string,

  incomingAttackerShips: ShipUnit[] = [],

  options: Pick<CombatOptions, 'supportSides'> = {},

): CombatPreview | null {

  const cell = cellAt(game, coord)

  if (!cell) return null

  if (!isCombatDestination(game, attackerId, coord)) return null



  const defenderId = inferDefenderId(cell, attackerId)

  if (!defenderId) return null



  const defenderShips = cell.ships.filter((s) => s.ownerId === defenderId)

  const attackerShips = incomingAttackerShips.filter((s) => s.ownerId === attackerId)



  const shieldContributions = collectShieldContributions(game, coord, defenderId)



  const supportNotes: string[] = []

  const attSupport = collectSupportShips(

    game,

    coord,

    attackerId,

    new Set(attackerShips.map((s) => s.id)),

  )

  const defSupport = collectSupportShips(

    game,

    coord,

    defenderId,

    new Set(defenderShips.map((s) => s.id)),

  )

  const supportCandidates = new Map<string, CombatSupportShip[]>()
  for (const player of game.players) {
    if (player.id === attackerId || player.id === defenderId) continue
    const ships = collectSupportShips(game, coord, player.id)
    if (ships.length) supportCandidates.set(player.id, ships)
  }
  const assignedAttackerSupport: CombatSupportShip[] = []
  const assignedDefenderSupport: CombatSupportShip[] = []
  for (const [playerId, ships] of supportCandidates) {
    if (options.supportSides?.[playerId] === 'attacker') assignedAttackerSupport.push(...ships)
    if (options.supportSides?.[playerId] === 'defender') assignedDefenderSupport.push(...ships)
  }

  if (attSupport.length || defSupport.length) {

    supportNotes.push(

      `Поддержка: атакующий +${attSupport.reduce((s, x) => s + x.supportDice, 0)}, защитник +${defSupport.reduce((s, x) => s + x.supportDice, 0)} (fireRange).`,

    )

  }



  return {

    coord,

    coordKey: hexKey(coord.q, coord.r),

    trigger: 'movement',

    attackerId,

    defenderId,

    attacker: buildSidePreview(game, coord, attackerId, 'attacker', attackerShips, assignedAttackerSupport),

    defender: buildSidePreview(game, coord, defenderId, 'defender', defenderShips, assignedDefenderSupport),

    shieldContributions,

    shieldAbsorbTotal: shieldContributions.reduce((s, c) => s + c.absorbCapacity, 0),

    destructionOrder: [...DESTRUCTION_PRIORITY],

    supportCandidates: [...supportCandidates.entries()].map(([playerId, ships]) => ({ playerId, ships })),

    notes: [

      'Раунд: priority skip → кубики → победитель → уничтожение по приоритету.',

      `Щит на клетке: до ${SHIELD_ABSORB_SELF}; с соседа: до ${SHIELD_ABSORB_NEIGHBOR} (пример 4+2).`,

      'Priority skip — бесплатное объявление по типу корабля (один skip на тип).',

      'combatDice — на гексе боя; supportDice — с клеток в пределах fireRange.',

      ...supportNotes,

    ],

  }

}



/** Сканирует поле: клетки с кораблями 2+ игроков */

export function detectCombats(game: GameSnapshot): DetectedCombat[] {

  const pending: DetectedCombat[] = []



  for (const cell of game.cells) {

    const owners = distinctOwners(cell.ships)

    if (owners.length < 2) continue



    const [first, second] = owners

    pending.push({

      id: `combat-${hexKey(cell.coord.q, cell.coord.r)}`,

      coord: { ...cell.coord },

      trigger: 'stack',

      attackerId: first,

      defenderId: second,

      attackerShipIds: cell.ships.filter((s) => s.ownerId === first).map((s) => s.id),

    })

  }



  return pending

}



/** Бои, которые возникнут после применения планируемых ходов */

export function detectCombatsFromMoves(

  game: GameSnapshot,

  moves: ShipMoveCombatInput[],

  attackerId: string,

): DetectedCombat[] {

  const pending: DetectedCombat[] = []

  const seen = new Set<string>()



  for (const move of moves) {

    const key = hexKey(move.to.q, move.to.r)

    if (seen.has(key)) continue

    if (!isCombatDestination(game, attackerId, move.to)) continue



    const cell = cellAt(game, move.to)!

    const defenderId = inferDefenderId(cell, attackerId)

    if (!defenderId) continue



    seen.add(key)

    pending.push({

      id: `combat-move-${key}`,

      coord: { ...move.to },

      trigger: 'movement',

      attackerId,

      defenderId,

      attackerShipIds: moves

        .filter((m) => hexKey(m.to.q, m.to.r) === key)

        .map((m) => m.shipId),

    })

  }



  return pending

}



export function rollD6(count = 1, rng: () => number = Math.random, fixedValue?: number): number[] {
  if (fixedValue != null) {
    return Array.from({ length: count }, () => fixedValue)
  }
  return Array.from({ length: count }, () => Math.floor(rng() * 6) + 1)
}



/** Сумма выпавших кубиков одной стороны по журналу бросков раунда */

export function sumCombatSideDiceTotal(

  shipRolls: readonly ShipCombatRollLog[],

  side: 'attacker' | 'defender',

): number {

  return shipRolls

    .filter((r) => r.side === side)

    .reduce((sum, r) => sum + r.total, 0)

}



/**
 * Очки уничтожения раунда: |сумма атакующего − сумма защитника| (PDF / rulebook).
 * При ничьей — 0.
 */
export function computeRoundDamage(
  round: Pick<CombatRoundResult, 'attackerTotal' | 'defenderTotal' | 'winner'>,
): number {
  if (round.winner === 'draw') return 0
  return Math.abs(round.attackerTotal - round.defenderTotal)
}

/** Человекочитаемая строка итога раунда — суммы d6 и очки уничтожения */
export function formatCombatRoundDiceTotals(
  round: Pick<CombatRoundResult, 'attackerTotal' | 'defenderTotal' | 'winner'>,
  roundNumber = 1,
  options?: { bombardment?: boolean },
): string {
  if (options?.bombardment) {
    return `Обстрел — сумма кубиков атакующего ${round.attackerTotal}; очки уничтожения ${round.attackerTotal}`
  }
  const margin = computeRoundDamage(round)
  const base = `Раунд ${roundNumber} — сумма кубиков: атакующий ${round.attackerTotal}, защитник ${round.defenderTotal}`
  if (round.winner === 'draw') return `${base}; ничья — очки уничтожения 0`
  return `${base}; очки уничтожения ${margin}`
}

/**
 * Бросок 1-го раунда: каждый корабль кидает свои кубики отдельно.
 * combatDice — участники на гексе; supportDice — соседи в fireRange.
 * Обстрел (PDF): бросает только атакующий; защитник пассивен; winner всегда attacker.
 */
export function rollCombatRound(
  preview: CombatPreview,
  rng: () => number = Math.random,
  fixedDiceValue?: number,
): CombatRoundResult {
  const shipRolls: ShipCombatRollLog[] = []
  const isBombardment = preview.trigger === 'bombardment'
  const sides = isBombardment ? [preview.attacker] : [preview.attacker, preview.defender]

  for (const side of sides) {
    for (const participant of side.ships) {
      const diceCount = SHIP_COMBAT_DICE[participant.type] ?? 0
      if (diceCount <= 0) continue

      const combatRolls = rollD6(diceCount, rng, fixedDiceValue)
      const total = combatRolls.reduce((a, b) => a + b, 0)
      shipRolls.push({
        shipId: participant.shipId,
        shipType: participant.type,
        ownerId: participant.ownerId,
        side: side.role,
        combatRolls,
        total,
      })
    }

    for (const support of side.supportingShips) {
      const rolls = rollD6(support.supportDice, rng, fixedDiceValue)
      const total = rolls.reduce((a, b) => a + b, 0)
      shipRolls.push({
        shipId: support.shipId,
        shipType: support.type,
        ownerId: support.ownerId,
        side: side.role,
        combatRolls: [],
        supportRolls: [{ fromShipId: support.shipId, rolls }],
        total,
      })
    }
  }

  const attackerTotal = sumCombatSideDiceTotal(shipRolls, 'attacker')
  const defenderTotal = isBombardment ? 0 : sumCombatSideDiceTotal(shipRolls, 'defender')

    let winner: CombatRoundResult['winner']
  if (isBombardment) {
    // PDF: сумма обстрела = очки уничтожения; ничьей нет (иначе бесконечный re-roll при 0).
    winner = 'attacker'
  } else if (attackerTotal > defenderTotal) winner = 'attacker'
  else if (attackerTotal < defenderTotal) winner = 'defender'
  else winner = 'draw'

  return { attackerTotal, defenderTotal, winner, shipRolls }
}

/** Удаляет корабли по id со всех клеток snapshot */
export function removeShipsFromSnapshot(game: GameSnapshot, shipIds: readonly string[]): void {
  if (shipIds.length === 0) return
  const removeSet = new Set(shipIds)
  for (const cell of game.cells) {
    cell.ships = cell.ships.filter((s) => !removeSet.has(s.id))
  }
}

function findShipUnit(game: GameSnapshot, shipId: string): (ShipUnit & { cell: RuntimeCellState }) | null {
  for (const cell of game.cells) {
    const ship = cell.ships.find((s) => s.id === shipId)
    if (ship) return { ...ship, cell }
  }
  return null
}

function validatePrioritySkipPlans(
  plans: CombatPrioritySkipPlan[] | undefined,
  allowedShipTypes: Set<ShipType>,
): string[] {
  if (!plans?.length) return []
  const errors: string[] = []
  const seen = new Set<ShipType>()

  for (const plan of plans) {
    if (seen.has(plan.shipType)) {
      errors.push(`Priority skip для ${SHIP_LABELS[plan.shipType]} указан дважды`)
      continue
    }
    seen.add(plan.shipType)

    if (!allowedShipTypes.has(plan.shipType)) {
      errors.push(`Тип ${SHIP_LABELS[plan.shipType]} не участвует в бою на вашей стороне`)
    }
  }

  return errors
}

function applyPrioritySkips(
  plans: CombatPrioritySkipPlan[] | undefined,
  skipTypes: Set<ShipType>,
): BattleLogEntry[] {
  const log: BattleLogEntry[] = []
  if (!plans?.length) return log

  for (const plan of plans) {
    skipTypes.add(plan.shipType)
    log.push({
      step: 'priority-skip',
      message: `${SHIP_LABELS[plan.shipType]} (все): priority skip`,
      data: { shipType: plan.shipType },
    })
  }

  return log
}

/** Поглощение урона щитами: сначала self (4), затем neighbor (2) */
export function applyShieldAbsorption(
  damage: number,
  contributions: readonly ShieldContribution[],
): { remainingDamage: number; absorbed: number } {
  let remaining = Math.max(0, damage)
  let absorbed = 0

  const ordered = [...contributions].sort((a, b) => {
    if (a.scope === b.scope) return a.shipId.localeCompare(b.shipId)
    return a.scope === 'self' ? -1 : 1
  })

  for (const sh of ordered) {
    if (remaining <= 0) break
    const take = Math.min(remaining, sh.absorbCapacity)
    remaining -= take
    absorbed += take
  }

  return { remainingDamage: remaining, absorbed }
}

export function sortShipsForDestruction(
  ships: readonly ShipUnit[],
  prioritySkipTypes: ReadonlySet<ShipType>,
  tieBreak?: readonly string[],
  ignoreDestructionPriority = false,
): ShipUnit[] {
  const tieIndex = (id: string) => {
    if (!tieBreak?.length) return 999
    const idx = tieBreak.indexOf(id)
    return idx >= 0 ? idx : 999
  }

  return [...ships].sort((a, b) => {
    if (!ignoreDestructionPriority) {
      const tierDiff = compareDestructionPriority(a.type, b.type)
      if (tierDiff !== 0) return tierDiff
    }

    const skipA = prioritySkipTypes.has(a.type) ? 1 : 0
    const skipB = prioritySkipTypes.has(b.type) ? 1 : 0
    if (skipA !== skipB) return skipA - skipB

    const tieDiff = tieIndex(a.id) - tieIndex(b.id)
    if (tieDiff !== 0) return tieDiff

    return a.id.localeCompare(b.id)
  })
}

export function getImmediatelyDestroyableShipIds(
  orderedShips: readonly ShipUnit[],
  damage: number,
  prioritySkipTypes: ReadonlySet<ShipType>,
  destroyCostForType: (type: ShipType) => number,
  ignoreDestructionPriority = false,
): string[] {
  if (orderedShips.length === 0 || damage <= 0) return []

  const first = orderedShips[0]!
  const frontTier = ignoreDestructionPriority ? null : destructionTierIndex(first.type)
  const frontSkipped = prioritySkipTypes.has(first.type)

  const immediate: string[] = []
  for (const ship of orderedShips) {
    const sameFront =
      ignoreDestructionPriority ||
      (destructionTierIndex(ship.type) === frontTier &&
        prioritySkipTypes.has(ship.type) === frontSkipped)
    if (!sameFront) break
    if (destroyCostForType(ship.type) <= damage) {
      immediate.push(ship.id)
    }
  }
  return immediate
}

export function buildDestructionSelectionState(
  game: GameSnapshot,
  loserShips: readonly ShipUnit[],
  damage: number,
  prioritySkipTypes: ReadonlySet<ShipType>,
  tieBreak?: readonly string[],
): DestructionSelectionState {
  const turnMods = getTurnModifiers(game)
  const destroyCostForType = (type: ShipType) =>
    getDestroyCostWithPrioritySkip(type, prioritySkipTypes, getEffectiveDestroyCost(game, type))
  const ignorePriority = turnMods.ignoreDestructionPriority

  const ordered = sortShipsForDestruction(
    loserShips,
    prioritySkipTypes,
    tieBreak,
    ignorePriority,
  )
  const totalCost = ordered.reduce((sum, s) => sum + destroyCostForType(s.type), 0)
  const forceFullWipe = damage >= totalCost && ordered.length > 0

  const immediatelyDestroyableIds = getImmediatelyDestroyableShipIds(
    ordered,
    damage,
    prioritySkipTypes,
    destroyCostForType,
    ignorePriority,
  )

  const selectableIds = ordered
    .filter((s) => destroyCostForType(s.type) <= damage)
    .map((s) => s.id)

  return {
    remainingDamage: damage,
    loserShipIds: ordered.map((s) => s.id),
    destroyCostByShipId: Object.fromEntries(
      ordered.map((s) => [s.id, destroyCostForType(s.type)]),
    ),
    immediatelyDestroyableIds,
    selectableIds,
    forceFullWipe,
  }
}

export function validateDestructionSelection(
  loserShips: readonly ShipUnit[],
  selectedIds: readonly string[],
  damage: number,
  prioritySkipTypes: ReadonlySet<ShipType>,
  options?: {
    ignoreDestructionPriority?: boolean
    destroyCostForType?: (type: ShipType) => number
  },
): string[] {
  const errors: string[] = []
  if (selectedIds.length === 0) return errors

  const destroyCostForType =
    options?.destroyCostForType
    ?? ((type: ShipType) => getDestroyCostWithPrioritySkip(type, prioritySkipTypes))
  const ignorePriority = options?.ignoreDestructionPriority ?? false
  const selected = new Set(selectedIds)

  let totalCost = 0
  for (const id of selectedIds) {
    const ship = loserShips.find((s) => s.id === id)
    if (!ship) {
      errors.push(`Корабль ${id} не участвует в бою`)
      continue
    }
    totalCost += destroyCostForType(ship.type)
  }
  if (totalCost > damage) {
    errors.push(`Сумма destroyCost (${totalCost}) превышает бюджет урона (${damage})`)
  }

  const ordered = sortShipsForDestruction(
    loserShips,
    prioritySkipTypes,
    undefined,
    ignorePriority,
  )
  for (const selectedId of selectedIds) {
    const selectedIdx = ordered.findIndex((s) => s.id === selectedId)
    if (selectedIdx < 0) continue
    for (let i = 0; i < selectedIdx; i++) {
      const higher = ordered[i]!
      if (!selected.has(higher.id) && !prioritySkipTypes.has(higher.type)) {
        errors.push(
          `Нельзя уничтожить ${SHIP_LABELS[ordered[selectedIdx]!.type]} раньше ${SHIP_LABELS[higher.type]}`,
        )
      }
    }
  }

  return errors
}

export function selectShipsToDestroy(
  loserShips: readonly ShipUnit[],
  damage: number,
  prioritySkipTypes: ReadonlySet<ShipType>,
  tieBreak?: readonly string[],
  options?: {
    ignoreDestructionPriority?: boolean
    destroyCostForType?: (type: ShipType) => number
  },
): string[] {
  if (damage <= 0 || loserShips.length === 0) return []

  const destroyCostForType =
    options?.destroyCostForType
    ?? ((type: ShipType) => getDestroyCostWithPrioritySkip(type, prioritySkipTypes))
  const ordered = sortShipsForDestruction(
    loserShips,
    prioritySkipTypes,
    tieBreak,
    options?.ignoreDestructionPriority,
  )
  const destroyed: string[] = []
  let remaining = damage

  for (const ship of ordered) {
    const cost = destroyCostForType(ship.type)
    if (cost > remaining) break
    destroyed.push(ship.id)
    remaining -= cost
  }

  return destroyed
}

function loserShipsForSide(
  preview: CombatPreview,
  loserRole: 'attacker' | 'defender',
  incomingAttackerShips: readonly ShipUnit[],
  game: GameSnapshot,
  coord: HexCoord,
): ShipUnit[] {
  if (loserRole === 'defender') {
    const cell = cellAt(game, coord)
    return cell?.ships.filter((s) => s.ownerId === preview.defenderId) ?? []
  }

  return incomingAttackerShips.filter((s) => s.ownerId === preview.attackerId)
}

function maybeTransferControl(
  game: GameSnapshot,
  coord: HexCoord,
  attackerId: string,
  defenderId: string,
): void {
  const cell = cellAt(game, coord)
  if (!cell) return

  const defenderRemaining = cell.ships.some((s) => s.ownerId === defenderId)
  if (defenderRemaining) return

  cell.controlOwnerId = attackerId
}

/**

 * Полное разрешение боя на клетке: priority skip → кубики (повтор при ничьей) → щиты → уничтожение.

 * Не перемещает корабли — только возвращает destroyedShipIds и attackerWon.

 */

export function resolveCombatAtCell(
  game: GameSnapshot,
  coord: HexCoord,
  attackerId: string,
  incomingAttackerShips: ShipUnit[] = [],
  options: CombatOptions = {},
  rng: () => number = Math.random,
  previewOverride?: CombatPreview,
): CombatResolutionResult {
  const preview =
    previewOverride ?? buildCombatPreview(game, coord, attackerId, incomingAttackerShips)
  const log: BattleLogEntry[] = []
  const turnMods = getTurnModifiers(game)
  const fixedDice = turnMods.fixedDiceValue

  if (!preview) {
    return {
      coord,
      winnerId: null,
      attackerWon: false,
      log: [{ step: 'round-winner', message: 'Нет боя на этой клетке' }],
      destroyedShipIds: [],
      stub: false,
    }
  }

  const attackerSkipTypes = new Set<ShipType>()
  const defenderSkipTypes = new Set<ShipType>()

  log.push(...applyPrioritySkips(options.attacker?.prioritySkips, attackerSkipTypes))
  log.push(...applyPrioritySkips(options.defender?.prioritySkips, defenderSkipTypes))

  const rounds: CombatRoundResult[] = []
  let round = rollCombatRound(preview, rng, fixedDice)
  rounds.push(round)
  let roundNumber = 1

  while (round.winner === 'draw') {
    roundNumber += 1
    round = rollCombatRound(preview, rng, fixedDice)
    rounds.push(round)
  }

  log.push({
    step: 'dice-roll',
    message: formatCombatRoundDiceTotals(round, roundNumber, {
      bombardment: preview.trigger === 'bombardment',
    }),
    data: { round, roundNumber, rounds },
  })

  const attackerWon = round.winner === 'attacker'
  const winnerId = attackerWon ? preview.attackerId : preview.defenderId
  const loserRole = attackerWon ? 'defender' : 'attacker'
  const loserSkipTypes = attackerWon ? defenderSkipTypes : attackerSkipTypes
  const loserOptions = attackerWon ? options.defender : options.attacker

  log.push({
    step: 'round-winner',
    message: `Победитель раунда: ${winnerId}`,
    data: {
      winner: round.winner,
      attackerTotal: round.attackerTotal,
      defenderTotal: round.defenderTotal,
    },
  })

  const rawDamage = computeRoundDamage(round)
  const shieldResult = applyShieldAbsorption(
    rawDamage,
    preview.shieldContributions,
  )

  log.push({
    step: 'shield-absorb',
    message:
      shieldResult.absorbed > 0
        ? `Очки уничтожения ${rawDamage}: щиты поглотили ${shieldResult.absorbed} (осталось ${shieldResult.remainingDamage})`
        : `Очки уничтожения ${rawDamage}: щиты не поглотили урон`,
    data: {
      rawDamage,
      absorbed: shieldResult.absorbed,
      remainingDamage: shieldResult.remainingDamage,
      contributions: preview.shieldContributions,
    },
  })

  const loserShips = loserShipsForSide(
    preview,
    loserRole,
    incomingAttackerShips,
    game,
    coord,
  )

  const destroyOpts = {
    ignoreDestructionPriority: turnMods.ignoreDestructionPriority,
    destroyCostForType: (type: ShipType) =>
      getDestroyCostWithPrioritySkip(type, loserSkipTypes, getEffectiveDestroyCost(game, type)),
  }

  const destructionState = buildDestructionSelectionState(
    game,
    loserShips,
    shieldResult.remainingDamage,
    loserSkipTypes,
    loserOptions?.destructionTieBreak,
  )

  let destroyedShipIds: string[] = []
  let needsDestructionSelection = false

  if (shieldResult.remainingDamage <= 0 || loserShips.length === 0) {
    log.push({
      step: 'destruction',
      message: 'Уничтожений нет',
    })
  } else if (destructionState.selectableIds.length === 0) {
    log.push({
      step: 'destruction',
      message: `Ничья раунда без уничтожения: бюджет ${shieldResult.remainingDamage} меньше destroyCost всех доступных кораблей`,
      data: { destructionState },
    })
  } else if (destructionState.forceFullWipe) {
    destroyedShipIds = loserShips.map((s) => s.id)
    const labels = destroyedShipIds
      .map((id) => {
        const ship = loserShips.find((s) => s.id === id)
        return ship ? SHIP_LABELS[ship.type] : id
      })
      .join(', ')
    log.push({
      step: 'destruction',
      message: `Полное уничтожение (урон покрывает флот): ${labels}`,
      data: { destroyedShipIds, forceFullWipe: true },
    })
  } else if (options.destructionSelection) {
    const selectionErrors = validateDestructionSelection(
      loserShips,
      options.destructionSelection,
      shieldResult.remainingDamage,
      loserSkipTypes,
      destroyOpts,
    )
    if (selectionErrors.length) {
      log.push({
        step: 'destruction',
        message: selectionErrors[0]!,
      })
      return {
        coord,
        winnerId,
        attackerWon,
        log,
        destroyedShipIds: [],
        roundOne: rounds[0],
        rounds,
        shieldAbsorbed: shieldResult.absorbed,
        rawDamage,
        needsDestructionSelection: true,
        destructionState,
        stub: false,
      }
    }
    destroyedShipIds = [...options.destructionSelection]
    if (destroyedShipIds.length > 0) {
      const labels = destroyedShipIds
        .map((id) => {
          const ship = loserShips.find((s) => s.id === id)
          return ship ? SHIP_LABELS[ship.type] : id
        })
        .join(', ')
      log.push({
        step: 'destruction',
        message: `Уничтожены (выбор победителя): ${labels}`,
        data: { destroyedShipIds, order: preview.destructionOrder },
      })
    } else {
      log.push({
        step: 'destruction',
        message: 'Победитель не уничтожил кораблей',
      })
    }
  } else {
    needsDestructionSelection = true
    log.push({
      step: 'destruction',
      message: `Ожидается выбор уничтожения (бюджет ${shieldResult.remainingDamage})`,
      data: { destructionState },
    })
  }

  return {
    coord,
    winnerId,
    attackerWon,
    log,
    destroyedShipIds,
    roundOne: rounds[0],
    rounds,
    shieldAbsorbed: shieldResult.absorbed,
    rawDamage,
    needsDestructionSelection,
    destructionState: needsDestructionSelection ? destructionState : undefined,
    stub: false,
  }
}

/** Проверка combatOptions в pendingCombat.prep до старта боя или countdown */
export function validatePendingCombatPrepOptions(game: GameSnapshot): string[] {
  const pending = game.pendingCombat
  const prep = pending?.prep
  if (!pending || !prep) return ['Нет подготовки к бою']

  const [q, r] = pending.cellKey.split(',').map(Number)
  const coord = { q, r }
  const attackerId = pending.attackerId
  const opts = prep.combatOptions
  const incomingIds = prep.incomingAttackerShipIds ?? []

  if (pending.trigger === 'bombardment' && prep.bombardmentFrom && prep.bombardmentPlans) {
    const fromCell = cellAt(game, prep.bombardmentFrom)
    const bombardingShips = prep.bombardmentPlans
      .map((p) => fromCell?.ships.find((s) => s.id === p.shipId))
      .filter((s): s is ShipUnit => !!s)
    const preview = buildBombardmentPreview(game, coord, attackerId, bombardingShips, prep.bombardmentFrom)
    if (!preview) return ['Не удалось проверить параметры боя']
    return validateCombatOptions(game, preview, incomingIds, opts)
  }

  if (prep.movementFrom && prep.movementPlans) {
    const fromCell = cellAt(game, prep.movementFrom)
    const incomingShips = incomingIds
      .map((id) => fromCell?.ships.find((s) => s.id === id))
      .filter((s): s is ShipUnit => !!s)
    const preview = buildCombatPreview(game, coord, attackerId, incomingShips)
    if (!preview) return ['Не удалось проверить параметры боя']
    return validateCombatOptions(game, preview, incomingIds, opts)
  }

  return ['Некорректное состояние подготовки боя']
}

export function validateCombatOptions(
  game: GameSnapshot,
  preview: CombatPreview,
  incomingAttackerShipIds: readonly string[],
  options: CombatOptions = {},
): string[] {
  const attackerTypes = new Set<ShipType>([
    ...preview.attacker.ships.map((s) => s.type),
    ...preview.attacker.supportingShips.map((s) => s.type),
    ...incomingAttackerShipIds
      .map((id) => preview.attacker.ships.find((s) => s.shipId === id)?.type)
      .filter((t): t is ShipType => !!t),
  ])
  for (const id of incomingAttackerShipIds) {
    const ship = findShipUnit(game, id)
    if (ship) attackerTypes.add(ship.type)
  }
  const defenderTypes = new Set([
    ...preview.defender.ships.map((s) => s.type),
    ...preview.defender.supportingShips.map((s) => s.type),
  ])

  return [
    ...validatePrioritySkipPlans(options.attacker?.prioritySkips, attackerTypes),
    ...validatePrioritySkipPlans(options.defender?.prioritySkips, defenderTypes),
  ]
}

/** Применяет результат боя к snapshot: удаление кораблей, захват клетки при победе атакующего */
export interface ApplyCombatResultOptions {
  /** false для обстрела — атакующий не занимает клетку */
  transferControl?: boolean
}

export function applyCombatResultToSnapshot(
  game: GameSnapshot,
  result: CombatResolutionResult,
  attackerId: string,
  defenderId: string,
  options: ApplyCombatResultOptions = {},
): void {
  removeShipsFromSnapshot(game, result.destroyedShipIds)
  if (result.attackerWon && options.transferControl !== false) {
    maybeTransferControl(game, result.coord, attackerId, defenderId)
    const cell = cellAt(game, result.coord)
    const markerId = cell?.actionMarkerId
    const marker = markerId
      ? game.actionMarkers.find((candidate) => candidate.id === markerId)
      : undefined
    if (cell && marker?.ownerId === defenderId) {
      game.actionMarkers = game.actionMarkers.filter((candidate) => candidate.id !== marker.id)
      cell.actionMarkerId = null
    }
  }
}



/** Вероятности исхода первого раунда (перспектива атакующего) */

export interface RoundOneOutcomeOdds {

  win: number

  draw: number

  defeat: number

}



/**

 * Monte-Carlo оценка исхода первого раунда через rollCombatRound.

 * Щиты и уничтожение не моделируются — только победитель раунда по кубикам.

 */

export function estimateRoundOneOutcome(

  preview: CombatPreview,

  options?: { samples?: number; rng?: () => number },

): RoundOneOutcomeOdds {

  const samples = options?.samples ?? 800

  const rng = options?.rng ?? Math.random



  const attackerDice =

    preview.attacker.combatDiceTotal + preview.attacker.supportDiceTotal

  const defenderDice =

    preview.defender.combatDiceTotal + preview.defender.supportDiceTotal



  if (attackerDice === 0 && defenderDice === 0) {

    return { win: 1 / 3, draw: 1 / 3, defeat: 1 / 3 }

  }



  let wins = 0

  let draws = 0

  let defeats = 0



  for (let i = 0; i < samples; i++) {

    const round = rollCombatRound(preview, rng)

    if (round.winner === 'attacker') wins++

    else if (round.winner === 'draw') draws++

    else defeats++

  }



  return {

    win: wins / samples,

    draw: draws / samples,

    defeat: defeats / samples,

  }

}



/** Полная боевая система активна (не stub) */
export const COMBAT_STUB = false

export function defenderIdsOnCell(
  game: GameSnapshot,
  coord: HexCoord,
  attackerId: string,
): string[] {
  const cell = cellAt(game, coord)
  if (!cell) return []
  return [...new Set(cell.ships.filter((s) => s.ownerId !== attackerId).map((s) => s.ownerId))]
}

export function combatShouldContinueAfterRound(
  game: GameSnapshot,
  coord: HexCoord,
  attackerId: string,
): boolean {
  const cell = cellAt(game, coord)
  if (!cell) return false
  const defenders = defenderIdsOnCell(game, coord, attackerId)
  if (!defenders.length) return false
  return cell.ships.some((s) => s.ownerId === attackerId)
}

function incomingShipsForPendingContinuation(
  game: GameSnapshot,
  pending: NonNullable<GameSnapshot['pendingCombat']>,
): ShipUnit[] {
  const continuation = pending.continuation
  if (!continuation) return []
  const fromCell = cellAt(game, continuation.movementFrom)
  return continuation.incomingAttackerShipIds
    .map((id) => fromCell?.ships.find((ship) => ship.id === id))
    .filter((ship): ship is ShipUnit => !!ship)
}

/** В бою перемещением атакующие остаются на исходной клетке до финального исхода. */
export function combatShouldContinueWithIncomingShips(
  game: GameSnapshot,
  coord: HexCoord,
  attackerId: string,
  incomingAttackerShipIds: readonly string[],
): boolean {
  if (!defenderIdsOnCell(game, coord, attackerId).length) return false
  return incomingAttackerShipIds.some((id) => findShipUnit(game, id)?.ownerId === attackerId)
}

export function getCombatRetreatDestinations(
  game: GameSnapshot,
  playerId: string,
): HexCoord[] {
  const pending = game.pendingCombat
  if (!pending?.awaitingContinue || !canRetreatFromBattle(game)) return []
  const [q, r] = pending.cellKey.split(',').map(Number)
  const battleCoord = { q, r }
  const isAttacker = pending.attackerId === playerId
  const isDefender = pending.defenderIds.includes(playerId)
  if (!isAttacker && !isDefender) return []
  if (isDefender && pending.continueDecisions?.attacker !== true) return []

  return game.cells
    .filter((cell) =>
      hexDistance(battleCoord, cell.coord) === 1
      && !cell.ships.some((ship) => ship.ownerId !== playerId),
    )
    .map((cell) => ({ ...cell.coord }))
}

/** Состояние раунда, ожидающего ручного выбора уничтожения */
export interface PendingCombatRoundState {
  rounds: CombatRoundResult[]
  shieldAbsorbed: number
  rawDamage: number
  remainingDamage: number
  winnerId: string
  attackerWon: boolean
  defenderId: string
  combatOptions: CombatOptions
  incomingAttackerShipIds: string[]
  attackerSkipTypes: ShipType[]
  defenderSkipTypes: ShipType[]
  trigger: 'movement' | 'stack' | 'bombardment'
  movementFrom?: HexCoord
  movementPlans?: Array<{ shipId: string; to: HexCoord; declareControl?: boolean }>
  bombardmentFrom?: HexCoord
  bombardmentPlans?: Array<{ shipId: string; target: HexCoord }>
  /** Оставшиеся цели обстрела после текущей клетки */
  queuedBombardmentPlans?: Array<{ shipId: string; target: HexCoord }>
}

export function applyCombatDestructionSelection(
  game: GameSnapshot,
  coord: HexCoord,
  incomingAttackerShips: readonly ShipUnit[],
  preview: CombatPreview,
  roundState: PendingCombatRoundState,
  destructionSelection: string[],
): CombatResolutionResult {
  const log: BattleLogEntry[] = []
  const turnMods = getTurnModifiers(game)
  const round = roundState.rounds[roundState.rounds.length - 1]!
  const attackerWon = roundState.attackerWon
  const winnerId = roundState.winnerId
  const loserRole = attackerWon ? 'defender' : 'attacker'
  const loserSkipTypes = new Set<ShipType>(
    attackerWon ? roundState.defenderSkipTypes : roundState.attackerSkipTypes,
  )
  const loserOptions = attackerWon ? roundState.combatOptions.defender : roundState.combatOptions.attacker

  log.push({
    step: 'round-winner',
    message: `Победитель раунда: ${winnerId}`,
    data: { winner: round.winner, attackerTotal: round.attackerTotal, defenderTotal: round.defenderTotal },
  })
  log.push({
    step: 'shield-absorb',
    message:
      roundState.shieldAbsorbed > 0
        ? `Очки уничтожения ${roundState.rawDamage}: щиты поглотили ${roundState.shieldAbsorbed} (осталось ${roundState.remainingDamage})`
        : `Очки уничтожения ${roundState.rawDamage}: щиты не поглотили урон`,
  })

  const loserShips = loserShipsForSide(preview, loserRole, incomingAttackerShips, game, coord)
  const destroyOpts = {
    ignoreDestructionPriority: turnMods.ignoreDestructionPriority,
    destroyCostForType: (type: ShipType) =>
      getDestroyCostWithPrioritySkip(type, loserSkipTypes, getEffectiveDestroyCost(game, type)),
  }

  const selectionErrors = validateDestructionSelection(
    loserShips,
    destructionSelection,
    roundState.remainingDamage,
    loserSkipTypes,
    destroyOpts,
  )
  if (selectionErrors.length) {
    return {
      coord,
      winnerId,
      attackerWon,
      log: [...log, { step: 'destruction', message: selectionErrors[0]! }],
      destroyedShipIds: [],
      roundOne: roundState.rounds[0],
      rounds: roundState.rounds,
      shieldAbsorbed: roundState.shieldAbsorbed,
      rawDamage: roundState.rawDamage,
      needsDestructionSelection: true,
      destructionState: buildDestructionSelectionState(
        game,
        loserShips,
        roundState.remainingDamage,
        loserSkipTypes,
        loserOptions?.destructionTieBreak,
      ),
      stub: false,
    }
  }

  const destroyedShipIds = [...destructionSelection]
  if (destroyedShipIds.length > 0) {
    const labels = destroyedShipIds
      .map((id) => {
        const ship = loserShips.find((s) => s.id === id)
        return ship ? SHIP_LABELS[ship.type] : id
      })
      .join(', ')
    log.push({
      step: 'destruction',
      message: `Уничтожены (выбор победителя): ${labels}`,
      data: { destroyedShipIds },
    })
  } else {
    log.push({ step: 'destruction', message: 'Победитель не уничтожил кораблей' })
  }

  return {
    coord,
    winnerId,
    attackerWon,
    log,
    destroyedShipIds,
    roundOne: roundState.rounds[0],
    rounds: roundState.rounds,
    shieldAbsorbed: roundState.shieldAbsorbed,
    rawDamage: roundState.rawDamage,
    stub: false,
  }
}

export function setupPendingCombatDestruction(
  game: GameSnapshot,
  coord: HexCoord,
  attackerId: string,
  defenderId: string,
  result: CombatResolutionResult,
  combatOptions: CombatOptions,
  skipTypes: { attacker: ShipType[]; defender: ShipType[] },
  trigger: NonNullable<PendingCombat['trigger']> = 'movement',
  extra?: Pick<
    PendingCombatRoundState,
    | 'movementFrom'
    | 'movementPlans'
    | 'bombardmentFrom'
    | 'bombardmentPlans'
    | 'incomingAttackerShipIds'
    | 'queuedBombardmentPlans'
  >,
): void {
  const remainingDamage = result.destructionState?.remainingDamage ?? 0
  game.pendingCombat = {
    cellKey: hexKey(coord.q, coord.r),
    attackerId,
    defenderIds: defenderIdsOnCell(game, coord, attackerId),
    roundNumber: 1,
    awaitingContinue: false,
    awaitingDestruction: true,
    trigger,
    combatOptions,
    roundState: {
      rounds: result.rounds ?? (result.roundOne ? [result.roundOne] : []),
      shieldAbsorbed: result.shieldAbsorbed ?? 0,
      rawDamage: result.rawDamage ?? 0,
      remainingDamage,
      winnerId: result.winnerId!,
      attackerWon: result.attackerWon,
      defenderId,
      combatOptions,
      incomingAttackerShipIds: extra?.incomingAttackerShipIds ?? [],
      attackerSkipTypes: skipTypes.attacker,
      defenderSkipTypes: skipTypes.defender,
      trigger,
      movementFrom: extra?.movementFrom,
      movementPlans: extra?.movementPlans,
      bombardmentFrom: extra?.bombardmentFrom,
      bombardmentPlans: extra?.bombardmentPlans,
      queuedBombardmentPlans: extra?.queuedBombardmentPlans,
    },
  }
}

export function confirmCombatDestruction(
  game: GameSnapshot,
  playerId: string,
  destructionSelection: string[],
): { errors: string[]; combatResult?: CombatResolutionResult } {
  const pending = game.pendingCombat
  if (!pending?.awaitingDestruction || !pending.roundState) {
    return { errors: ['Нет боя, ожидающего выбора уничтожения'] }
  }
  if (pending.roundState.winnerId !== playerId) {
    return { errors: ['Выбор уничтожения может сделать только победитель раунда'] }
  }

  const [q, r] = pending.cellKey.split(',').map(Number)
  const coord = { q, r }
  const rs = pending.roundState

  const incomingShips: ShipUnit[] = rs.incomingAttackerShipIds
    .map((id) => findShipUnit(game, id))
    .filter((s): s is ShipUnit & { cell: RuntimeCellState } => !!s)
    .map(({ id, type, ownerId }) => ({ id, type, ownerId }))

  const isBombardment = (rs.trigger ?? pending.trigger) === 'bombardment'
  const preview =
    isBombardment && rs.bombardmentFrom && rs.bombardmentPlans?.length
      ? (() => {
          const fromCell = cellAt(game, rs.bombardmentFrom!)
          const bombardingShips = rs.bombardmentPlans!
            .map((p) => fromCell?.ships.find((s) => s.id === p.shipId))
            .filter((s): s is ShipUnit => !!s)
          return buildBombardmentPreview(
            game,
            coord,
            pending.attackerId,
            bombardingShips,
            rs.bombardmentFrom!,
          )
        })()
      : buildCombatPreview(game, coord, pending.attackerId, incomingShips)
  if (!preview) {
    game.pendingCombat = undefined
    return { errors: ['Бой на клетке больше не актуален'] }
  }

  const result = applyCombatDestructionSelection(
    game,
    coord,
    incomingShips,
    preview,
    rs,
    destructionSelection,
  )

  if (result.needsDestructionSelection) {
    return {
      errors: [result.log.find((e) => e.step === 'destruction')?.message ?? 'Некорректный выбор уничтожения'],
    }
  }

  applyCombatResultToSnapshot(game, result, pending.attackerId, rs.defenderId, {
    transferControl: !isBombardment,
  })
  if (
    !isBombardment
    && rs.movementFrom
    && rs.movementPlans?.length
    && combatShouldContinueWithIncomingShips(
      game,
      coord,
      pending.attackerId,
      rs.incomingAttackerShipIds,
    )
  ) {
    setupPendingCombat(game, coord, pending.attackerId, pending.roundNumber, 'movement', {
      movementFrom: { ...rs.movementFrom },
      movementPlans: rs.movementPlans.map((move) => ({ ...move, to: { ...move.to } })),
      incomingAttackerShipIds: [...rs.incomingAttackerShipIds],
    })
    game.pendingCombat!.combatOptions = rs.combatOptions
    return { errors: [], combatResult: result }
  }
  game.pendingCombat = undefined

  return { errors: [], combatResult: result }
}

export function setupPendingCombat(
  game: GameSnapshot,
  coord: HexCoord,
  attackerId: string,
  roundNumber: number,
  trigger: PendingCombat['trigger'] = 'movement',
  continuation?: PendingCombat['continuation'],
): void {
  game.pendingCombat = {
    cellKey: hexKey(coord.q, coord.r),
    attackerId,
    defenderIds: defenderIdsOnCell(game, coord, attackerId),
    roundNumber,
    awaitingContinue: true,
    continueDecisions: {},
    trigger,
    continuation,
  }
}

export function continuePendingCombat(
  game: GameSnapshot,
  playerId: string,
  combatOptions?: CombatOptions,
  rng: () => number = Math.random,
): { errors: string[]; combatResult?: CombatResolutionResult } {
  const pending = game.pendingCombat
  if (!pending?.awaitingContinue) return { errors: ['Нет незавершённого боя'] }
  const defenderId = pending.defenderIds[0]
  if (playerId === pending.attackerId) {
    if (pending.continueDecisions?.attacker != null) {
      return { errors: ['Атакующий уже выбрал продолжение боя'] }
    }
    pending.continueDecisions = { ...pending.continueDecisions, attacker: true }
    return { errors: [] }
  }
  if (playerId !== defenderId) return { errors: ['Продолжить бой может только участник боя'] }
  if (pending.continueDecisions?.attacker !== true) {
    return { errors: ['Сначала решение о продолжении принимает атакующий'] }
  }
  if (pending.continueDecisions?.defender != null) {
    return { errors: ['Защитник уже выбрал продолжение боя'] }
  }
  pending.continueDecisions = { ...pending.continueDecisions, defender: true }

  const [q, r] = pending.cellKey.split(',').map(Number)
  const coord = { q, r }
  const incomingShips = incomingShipsForPendingContinuation(game, pending)
  const preview = buildCombatPreview(game, coord, pending.attackerId, incomingShips)
  if (!preview) {
    game.pendingCombat = undefined
    return { errors: [] }
  }

  const opts = combatOptions ?? pending.combatOptions
  const result = resolveCombatAtCell(
    game,
    coord,
    pending.attackerId,
    incomingShips,
    opts,
    rng,
    preview,
  )

  if (result.needsDestructionSelection) {
    const skipTypes = {
      attacker: (opts?.attacker?.prioritySkips ?? []).map((p) => p.shipType),
      defender: (opts?.defender?.prioritySkips ?? []).map((p) => p.shipType),
    }
    setupPendingCombatDestruction(
      game,
      coord,
      playerId,
      preview.defenderId,
      result,
      opts ?? {},
      skipTypes,
      pending.trigger ?? 'movement',
      { incomingAttackerShipIds: pending.continuation?.incomingAttackerShipIds ?? [] },
    )
    game.pendingCombat!.roundNumber = pending.roundNumber
    return { errors: [], combatResult: result }
  }

  applyCombatResultToSnapshot(game, result, pending.attackerId, preview.defenderId)

  const shouldContinue = pending.continuation
    ? combatShouldContinueWithIncomingShips(
        game,
        coord,
        pending.attackerId,
        pending.continuation.incomingAttackerShipIds,
      )
    : combatShouldContinueAfterRound(game, coord, pending.attackerId)
  if (shouldContinue) {
    setupPendingCombat(
      game,
      coord,
      pending.attackerId,
      pending.roundNumber + 1,
      pending.trigger,
      pending.continuation,
    )
    if (opts) game.pendingCombat!.combatOptions = opts
  } else {
    game.pendingCombat = undefined
  }

  return { errors: [], combatResult: result }
}

export function stopPendingCombat(
  game: GameSnapshot,
  playerId: string,
  retreatTo?: HexCoord,
): string[] {
  const pending = game.pendingCombat
  if (!pending) return []
  const defenderId = pending.defenderIds[0]
  const isAttacker = pending.attackerId === playerId
  const isDefender = defenderId === playerId
  if (!isAttacker && !isDefender) return ['Остановить бой может только участник боя']
  if (isDefender && pending.continueDecisions?.attacker !== true) {
    return ['Сначала решение о продолжении принимает атакующий']
  }
  if (!canRetreatFromBattle(game)) return ['«Стоять насмерть!»: отступление запрещено']
  if (!retreatTo) return ['Выберите соседнюю клетку для отступления']
  const destinations = getCombatRetreatDestinations(game, playerId)
  if (!destinations.some((coord) => hexKey(coord.q, coord.r) === hexKey(retreatTo.q, retreatTo.r))) {
    return ['Нельзя отступить в эту клетку: нужна соседняя клетка без вражеских кораблей']
  }
  const destination = cellAt(game, retreatTo)!
  const [q, r] = pending.cellKey.split(',').map(Number)
  const retreatingIds = isAttacker
    ? pending.continuation?.incomingAttackerShipIds
      ?? cellAt(game, { q, r })?.ships
        .filter((ship) => ship.ownerId === playerId)
        .map((ship) => ship.id) ?? []
    : cellAt(game, { q, r })?.ships
        .filter((ship) => ship.ownerId === playerId)
        .map((ship) => ship.id) ?? []
  for (const shipId of retreatingIds) {
    const found = findShipUnit(game, shipId)
    if (!found || found.ownerId !== playerId) continue
    found.cell.ships = found.cell.ships.filter((ship) => ship.id !== shipId)
    destination.ships.push({ id: found.id, type: found.type, ownerId: found.ownerId })
  }
  game.pendingCombat = undefined
  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'combat',
    message: `${isAttacker ? 'Атакующий' : 'Защитник'} отступил в (${retreatTo.q},${retreatTo.r})`,
    timestamp: Date.now(),
  })
  return []
}

function pendingCellAt(game: GameSnapshot, coord: HexCoord): RuntimeCellState | undefined {
  return cellAt(game, coord)
}

function buildCombatPreviewFromPendingPlans(
  game: GameSnapshot,
  pending: NonNullable<GameSnapshot['pendingCombat']>,
  coord: HexCoord,
  plans: {
    trigger?: PendingCombat['trigger']
    movementFrom?: HexCoord
    incomingAttackerShipIds?: string[]
    bombardmentFrom?: HexCoord
    bombardmentPlans?: { shipId: string; target: HexCoord }[]
  },
): CombatPreview | null {
  if (plans.trigger === 'bombardment' && plans.bombardmentFrom && plans.bombardmentPlans?.length) {
    const fromCell = pendingCellAt(game, plans.bombardmentFrom)
    if (!fromCell) return null
    const bombardingShips = plans.bombardmentPlans
      .map((p) => fromCell.ships.find((s) => s.id === p.shipId))
      .filter((s): s is ShipUnit => !!s)
    return buildBombardmentPreview(
      game,
      coord,
      pending.attackerId,
      bombardingShips,
      plans.bombardmentFrom,
    )
  }

  const fromCell = plans.movementFrom ? pendingCellAt(game, plans.movementFrom) : undefined
  const incomingShips = (plans.incomingAttackerShipIds ?? [])
    .map((id) => fromCell?.ships.find((s) => s.id === id))
    .filter((s): s is ShipUnit => !!s)

    return buildCombatPreview(game, coord, pending.attackerId, incomingShips, pending.prep?.combatOptions)
}

/** Превью боя из pendingCombat — prep, awaitingDestruction (roundState) или awaitingContinue */
export function buildCombatPreviewFromPending(game: GameSnapshot): CombatPreview | null {
  const pending = game.pendingCombat
  if (!pending) return null

  const [q, r] = pending.cellKey.split(',').map(Number)
  const coord = { q, r }

  if (pending.prep) {
    return buildCombatPreviewFromPendingPlans(game, pending, coord, {
      trigger: pending.trigger,
      movementFrom: pending.prep.movementFrom,
      incomingAttackerShipIds: pending.prep.incomingAttackerShipIds,
      bombardmentFrom: pending.prep.bombardmentFrom,
      bombardmentPlans: pending.prep.bombardmentPlans,
    })
  }

  if (pending.roundState) {
    const rs = pending.roundState
    return buildCombatPreviewFromPendingPlans(game, pending, coord, {
      trigger: rs.trigger ?? pending.trigger,
      movementFrom: rs.movementFrom,
      incomingAttackerShipIds: rs.incomingAttackerShipIds,
      bombardmentFrom: rs.bombardmentFrom,
      bombardmentPlans: rs.bombardmentPlans,
    })
  }

  if (pending.awaitingContinue) {
    return buildCombatPreview(
      game,
      coord,
      pending.attackerId,
      incomingShipsForPendingContinuation(game, pending),
    )
  }

  return null
}

export function setupCombatPrepForMovement(
  game: GameSnapshot,
  from: HexCoord,
  moves: import('./movement.js').ShipMovePlan[],
  playerId: string,
  combatCoord: HexCoord,
  incomingShipIds: string[],
): string[] {
  const fromCell = pendingCellAt(game, from)
  const incomingShips = incomingShipIds
    .map((id) => fromCell?.ships.find((s) => s.id === id))
    .filter((s): s is ShipUnit => !!s)
  const preview = buildCombatPreview(game, combatCoord, playerId, incomingShips)
  if (!preview) return ['Не удалось подготовить бой']

  game.pendingCombat = {
    cellKey: hexKey(combatCoord.q, combatCoord.r),
    attackerId: playerId,
    defenderIds: defenderIdsOnCell(game, combatCoord, playerId),
    roundNumber: 1,
    awaitingContinue: false,
    trigger: 'movement',
    prep: {
      phase: 'prep',
      defenderId: preview.defenderId,
      readyBy: {},
      combatOptions: {},
      movementFrom: from,
      movementPlans: moves.map((m) => ({ ...m, to: { ...m.to } })),
      incomingAttackerShipIds: [...incomingShipIds],
    },
  }

  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'combat',
    message: `Подготовка к бою на (${combatCoord.q},${combatCoord.r})`,
    timestamp: Date.now(),
  })
  return []
}

export function setupCombatPrepForBombardment(
  game: GameSnapshot,
  from: HexCoord,
  plans: import('./bombardment.js').BombardmentPlan[],
  playerId: string,
  target: HexCoord,
  queuedBombardmentPlans: import('./bombardment.js').BombardmentPlan[] = [],
): string[] {
  const fromCell = pendingCellAt(game, from)
  const bombardingShips = plans
    .map((p) => fromCell?.ships.find((s) => s.id === p.shipId))
    .filter((s): s is ShipUnit => !!s)
  const preview = buildBombardmentPreview(game, target, playerId, bombardingShips, from)
  if (!preview) return ['Не удалось подготовить бой']

  game.pendingCombat = {
    cellKey: hexKey(target.q, target.r),
    attackerId: playerId,
    defenderIds: defenderIdsOnCell(game, target, playerId),
    roundNumber: 1,
    awaitingContinue: false,
    trigger: 'bombardment',
    prep: {
      phase: 'prep',
      defenderId: preview.defenderId,
      readyBy: {},
      combatOptions: {},
      bombardmentFrom: from,
      bombardmentPlans: plans.map((p) => ({ shipId: p.shipId, target: { ...p.target } })),
      queuedBombardmentPlans: queuedBombardmentPlans.map((p) => ({
        shipId: p.shipId,
        target: { ...p.target },
      })),
      incomingAttackerShipIds: [],
    },
  }

  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'combat',
    message: `Подготовка к обстрелу на (${target.q},${target.r})`,
    timestamp: Date.now(),
  })
  return []
}

function mergeSideSkips(
  side: 'attacker' | 'defender',
  combatOptions: CombatOptions,
  prioritySkips?: CombatPrioritySkipPlan[],
): void {
  if (!prioritySkips?.length) return
  combatOptions[side] = {
    ...combatOptions[side],
    prioritySkips: prioritySkips.map((p) => ({ shipType: p.shipType })),
  }
}

export function updateCombatPrep(
  game: GameSnapshot,
  playerId: string,
  ready: boolean,
  prioritySkips?: CombatPrioritySkipPlan[],
  supportSide?: 'attacker' | 'defender' | null,
): { errors: string[] } {
  const pending = game.pendingCombat
  const prep = pending?.prep
  if (!pending || !prep) return { errors: ['Нет подготовки к бою'] }

  const isBombardment = pending.trigger === 'bombardment'
  const isAttacker = pending.attackerId === playerId
  const isDefender = prep.defenderId === playerId
  const supportCandidate = buildCombatPreviewFromPending(game)?.supportCandidates
    ?.find((candidate) => candidate.playerId === playerId)
  if (!isAttacker && !isDefender && !supportCandidate) {
    return { errors: ['Вы не можете поддержать этот бой'] }
  }
  if (!isAttacker && !isDefender) {
    if (supportSide == null) delete prep.combatOptions.supportSides?.[playerId]
    else {
      prep.combatOptions.supportSides = {
        ...prep.combatOptions.supportSides,
        [playerId]: supportSide,
      }
    }
    return { errors: [] }
  }
  if (isBombardment && isDefender) {
    return { errors: ['Защитник не участвует в подготовке обстрела — ожидайте решения атакующего'] }
  }

  const prevSideOptions = isAttacker
    ? prep.combatOptions.attacker
    : prep.combatOptions.defender

  if (isAttacker) {
    mergeSideSkips('attacker', prep.combatOptions, prioritySkips)
  } else if (!isBombardment) {
    mergeSideSkips('defender', prep.combatOptions, prioritySkips)
  }

  if (prioritySkips?.length) {
    const skipErrors = validatePendingCombatPrepOptions(game)
    if (skipErrors.length) {
      if (isAttacker) prep.combatOptions.attacker = prevSideOptions
      else prep.combatOptions.defender = prevSideOptions
      return { errors: skipErrors }
    }
  }

  if (!ready && prep.phase === 'countdown') {
    prep.phase = 'prep'
    prep.countdownStartedAt = undefined
    prep.readyBy = { [playerId]: false }
    return { errors: [] }
  }

  if (prep.phase === 'countdown') {
    if (prioritySkips?.length) {
      if (isAttacker) prep.combatOptions.attacker = prevSideOptions
      else prep.combatOptions.defender = prevSideOptions
    }
    return { errors: ['Обратный отсчёт уже идёт — отмените готовность, чтобы изменить skip'] }
  }

  if (ready) {
    const readyErrors = validatePendingCombatPrepOptions(game)
    if (readyErrors.length) {
      if (prioritySkips?.length) {
        if (isAttacker) prep.combatOptions.attacker = prevSideOptions
        else prep.combatOptions.defender = prevSideOptions
      }
      return { errors: readyErrors }
    }
  }

  prep.readyBy[playerId] = ready

  const attackerReady = prep.readyBy[pending.attackerId] === true
  const defenderReady = prep.readyBy[prep.defenderId] === true
  const prepComplete = isBombardment ? attackerReady : attackerReady && defenderReady

  if (prepComplete) {
    const countdownErrors = validatePendingCombatPrepOptions(game)
    if (countdownErrors.length) {
      delete prep.readyBy[playerId]
      return { errors: countdownErrors }
    }
    prep.phase = 'countdown'
    prep.countdownStartedAt = Date.now()
  } else if (!ready) {
    delete prep.readyBy[playerId]
  }

  return { errors: [] }
}

export function cancelCombatPrep(game: GameSnapshot, playerId: string): { errors: string[] } {
  const pending = game.pendingCombat
  if (!pending?.prep) return { errors: ['Нет подготовки к бою'] }
  if (pending.attackerId !== playerId) return { errors: ['Отменить подготовку может только атакующий'] }
  game.pendingCombat = undefined
  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'combat',
    message: 'Подготовка к бою отменена атакующим',
    timestamp: Date.now(),
  })
  return { errors: [] }
}

export function tickCombatPrepCountdown(game: GameSnapshot, now = Date.now()): boolean {
  const prep = game.pendingCombat?.prep
  if (!prep || prep.phase !== 'countdown' || prep.countdownStartedAt == null) return false
  return now - prep.countdownStartedAt >= COMBAT_PREP_COUNTDOWN_MS
}
