/**
 * Выбор целей на раунд боя: каждый игрок раздаёт кубики своих кораблей по вражеским кораблям
 * на клетке боя (ADR 018, «цели выбирает стреляющий»). Выбор действует один раунд — к
 * следующему урон меняется, и цели выбираются заново. Кубики, которым игрок цель не назначил,
 * раздаёт автоматика.
 */

import {
  allocateDice,
  hitProbability,
  type CombatDieSlot,
  type CombatTargetState,
} from './combat-hits.js'
import type {
  CombatOptions,
  CombatPreview,
  CombatRole,
  CombatSideOptions,
  CombatSidePreview,
} from './combat.js'
import type { GameSnapshot, PendingCombat } from './save-file.js'
import type { ShipType } from './types.js'

/** Один кубик игрока в раунде. */
export interface PlayerCombatDie {
  shooterShipId: string
  /** Номер кубика у этого корабля: 0, 1, … */
  index: number
  type: ShipType
  threshold: number
  /** 0 — стреляет с клетки боя, больше — поддержка или обстрел. */
  distance: number
}

/** id стреляющего → id цели для каждого его кубика по порядку; пустая строка — цель выберет игра. */
export type DiceTargets = Record<string, string[]>

/** На чьей стороне игрок стреляет в этом бою; `null` — не стреляет. */
export function combatSideOfPlayer(preview: CombatPreview, playerId: string): CombatRole | null {
  const fires = (side: CombatSidePreview) =>
    side.playerId === playerId
    || side.ships.some((ship) => ship.ownerId === playerId)
    || side.supportingShips.some((ship) => ship.ownerId === playerId)
  if (fires(preview.attacker)) return 'attacker'
  if (preview.trigger !== 'bombardment' && fires(preview.defender)) return 'defender'
  return null
}

/** Кубики игрока на этот раунд — с клетки боя и с поддержки. */
export function playerCombatDice(preview: CombatPreview, playerId: string): PlayerCombatDie[] {
  const role = combatSideOfPlayer(preview, playerId)
  if (!role) return []
  const side = role === 'attacker' ? preview.attacker : preview.defender
  const out: PlayerCombatDie[] = []
  for (const ship of side.ships) {
    if (ship.ownerId !== playerId || ship.threshold == null || ship.dice <= 0) continue
    if (ship.damage >= ship.hull) continue
    for (let index = 0; index < ship.dice; index++) {
      out.push({ shooterShipId: ship.shipId, index, type: ship.type, threshold: ship.threshold, distance: 0 })
    }
  }
  for (const ship of side.supportingShips) {
    if (ship.ownerId !== playerId || ship.dice <= 0) continue
    for (let index = 0; index < ship.dice; index++) {
      out.push({
        shooterShipId: ship.shipId,
        index,
        type: ship.type,
        threshold: ship.threshold,
        distance: ship.distance,
      })
    }
  }
  return out
}

/** Живые вражеские корабли на клетке боя — цели игрока. */
export function playerCombatTargets(
  preview: CombatPreview,
  playerId: string,
  damageByShipId: Readonly<Record<string, number>> = {},
): CombatTargetState[] {
  const role = combatSideOfPlayer(preview, playerId)
  if (!role) return []
  const enemy = role === 'attacker' ? preview.defender : preview.attacker
  return enemy.ships
    .map((ship) => ({
      shipId: ship.shipId,
      type: ship.type,
      hull: ship.hull,
      damage: damageByShipId[ship.shipId] ?? ship.damage,
      threat: ship.dice * hitProbability(ship.threshold),
    }))
    .filter((target) => target.damage < target.hull)
}

/** Распределение, которое предложила бы игра, — только кубики этого игрока. */
export function autoDiceTargetsFor(
  preview: CombatPreview,
  playerId: string,
  damageByShipId: Readonly<Record<string, number>> = {},
): DiceTargets {
  const dice = playerCombatDice(preview, playerId)
  const targets = playerCombatTargets(preview, playerId, damageByShipId)
  const slots: CombatDieSlot[] = dice.map((die) => ({
    shooterShipId: die.shooterShipId,
    threshold: die.threshold,
  }))
  const allocation = allocateDice(slots, targets)
  const out: DiceTargets = {}
  dice.forEach((die, i) => {
    const list = (out[die.shooterShipId] ??= [])
    list[die.index] = allocation[i] ?? ''
  })
  return out
}

/**
 * Проверить выбор игрока: стреляют только его корабли, цели — живые враги на клетке боя,
 * кубиков не больше, чем у корабля есть.
 */
export function validateDiceTargets(
  preview: CombatPreview,
  playerId: string,
  raw: unknown,
  damageByShipId: Readonly<Record<string, number>> = {},
): { errors: string[]; value: DiceTargets } {
  if (raw == null) return { errors: [], value: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['Некорректное распределение кубиков'], value: {} }
  }
  const diceByShooter = new Map<string, number>()
  for (const die of playerCombatDice(preview, playerId)) {
    diceByShooter.set(die.shooterShipId, (diceByShooter.get(die.shooterShipId) ?? 0) + 1)
  }
  const targetIds = new Set(playerCombatTargets(preview, playerId, damageByShipId).map((t) => t.shipId))
  const value: DiceTargets = {}
  for (const [shooterId, list] of Object.entries(raw as Record<string, unknown>)) {
    const dice = diceByShooter.get(shooterId)
    if (dice == null) return { errors: ['Кубики можно назначать только своим кораблям в этом бою'], value: {} }
    if (!Array.isArray(list) || list.some((id) => typeof id !== 'string')) {
      return { errors: ['Некорректное распределение кубиков'], value: {} }
    }
    if (list.length > dice) return { errors: ['Назначено больше кубиков, чем есть у корабля'], value: {} }
    if (list.some((id) => id !== '' && !targetIds.has(id))) {
      return { errors: ['Цель кубика — не вражеский корабль в этом бою'], value: {} }
    }
    value[shooterId] = [...(list as string[])]
  }
  return { errors: [], value }
}

/**
 * Бой глазами игрока: чужие цели на раунд скрыты до броска, иначе последний решающий видел бы
 * выбор соперника. Остаётся только то, кто уже подтвердил.
 */
export function maskPendingCombatForViewer(
  game: GameSnapshot,
  viewerId: string | null | undefined,
): PendingCombat | undefined {
  const pending = game.pendingCombat
  if (!pending) return undefined
  const ownerById = new Map<string, string>()
  for (const cell of game.cells) for (const ship of cell.ships) ownerById.set(ship.id, ship.ownerId)
  const maskOptions = (options: CombatOptions | undefined): CombatOptions | undefined => {
    if (!options) return options
    const side = (s: CombatSideOptions | undefined): CombatSideOptions | undefined => {
      if (!s?.diceTargets) return s
      const own = Object.entries(s.diceTargets).filter(([shooterId]) => ownerById.get(shooterId) === viewerId)
      return { ...s, diceTargets: Object.fromEntries(own) }
    }
    return { ...options, attacker: side(options.attacker), defender: side(options.defender) }
  }
  if (pending.phase === 'prep') {
    return { ...pending, prep: { ...pending.prep, combatOptions: maskOptions(pending.prep.combatOptions) ?? {} } }
  }
  return { ...pending, combatOptions: maskOptions(pending.combatOptions) }
}
