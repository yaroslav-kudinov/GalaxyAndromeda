/**
 * Бой на попаданиях (ADR 018).
 *
 * Один маркер действия — один бой. Бой многораундовый: каждый раунд обе стороны бросают кубики,
 * распределённые по вражеским кораблям, и попадания применяются одновременно. Урон копится
 * внутри боя и сбрасывается, когда бой кончился. Продолжение и отступление — как прежде:
 * пока в бою никто не уничтожен, раунды идут сами; после первого уничтожения стороны решают,
 * продолжать ли, сначала атакующий, затем защитник.
 *
 * Математика одного выстрела — в `combat-hits.ts`.
 */

import { SHIP_LABELS } from './constants.js'
import { buildBombardmentPreview } from './bombardment.js'
import {
  allocateDice,
  canShipFireFromDistance,
  carrierBonusAtDistance,
  hitProbability,
  MAX_DIE_VALUE,
  shipDice,
  shipFireRange,
  shipHitThreshold,
  shipHullInBattle,
  type CombatDieSlot,
  type CombatTargetState,
  type FireRange,
} from './combat-hits.js'
import {
  combatSideOfPlayer,
  playerCombatDice,
  validateDiceTargets,
} from './combat-targets.js'
import { doctrineShotModifier } from './doctrines.js'
import { hexDistance } from './map.js'
import { transferControlIfEnemyOwned } from './claim.js'
import { removeStaleProductionMarkerAt } from './markers.js'
import { canBesiegeCell, siegeAt } from './siege.js'
import { canSupportCombatSide, isCombatPrepSideReady, isEliminatedPlayer } from './surrender.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import type { PendingCombat, PendingCombatAwaitingContinue } from './save-file.js'
import type { HexCoord, ShipType, ShipUnit } from './types.js'
import { hexKey } from './types.js'

export type CombatTriggerKind = 'movement' | 'stack' | 'bombardment'

export type CombatRole = 'attacker' | 'defender'

/** Корабль на клетке боя: стреляет (если может) и служит целью. */
export interface CombatParticipant {
  shipId: string
  type: ShipType
  ownerId: string
  side: CombatRole
  /** Сколько попаданий нужно, чтобы его уничтожить, — с учётом клетки боя. */
  hull: number
  /** Попадания, уже полученные в этом бою. */
  damage: number
  /** Кубиков в раунде, с бонусом авианосца. 0 — не стреляет. */
  dice: number
  /** Из них от авианосца. */
  bonusDice: number
  /** Нужное на кубике значение; `null` — стрелять не может. */
  threshold: number | null
}

/** Корабль, стреляющий с чужой клетки: поддержка или обстрел. Целью не служит. */
export interface CombatSupportShip {
  shipId: string
  type: ShipType
  ownerId: string
  fromCoord: HexCoord
  distance: number
  dice: number
  bonusDice: number
  threshold: number
}

/** Игрок вне основных сторон, способный направить корабли поддержки. */
export interface CombatSupportCandidate {
  playerId: string
  ships: CombatSupportShip[]
  /**
   * Это гарнизон осаждённой клетки, где третий игрок бьётся с осаждающим: его корабли стоят на
   * клетке боя и, выбрав сторону, бьются на ней сами — стреляют и служат целями (ADR 019).
   */
  garrisonShipIds?: string[]
}

export interface CombatSidePreview {
  playerId: string
  role: CombatRole
  ships: CombatParticipant[]
  supportingShips: CombatSupportShip[]
  /** Все кубики стороны за раунд: с клетки боя и с поддержки. */
  diceTotal: number
  /** Ожидаемые попадания за раунд. */
  expectedHits: number
  /**
   * Перебросы кубиков за раунд: у осаждённого, дерущегося на своей клетке, — по одному на
   * каждый корабль гарнизона (ADR 019).
   */
  rerollPool?: number
}

export interface CombatPreview {
  coord: HexCoord
  coordKey: string
  trigger: CombatTriggerKind
  attackerId: string
  defenderId: string
  attacker: CombatSidePreview
  defender: CombatSidePreview
  supportCandidates?: CombatSupportCandidate[]
  /** Перебросы гарнизона осаждённой клетки в этом бою: по одному на его корабль в бою. */
  siegeRerolls?: { playerId: string; pool: number }
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

/** Один брошенный кубик. */
export interface CombatDieRoll {
  /** Итоговое значение — после перебросов, если они были. */
  value: number
  /** Прежние значения кубика, если осаждённый его перебрасывал. */
  rerolls?: number[]
  threshold: number
  /** По кому стреляли; `null` — целей не осталось. */
  targetShipId: string | null
  hit: boolean
}

/** Журнал бросков одного корабля в раунде. */
export interface ShipCombatRollLog {
  shipId: string
  shipType: ShipType
  ownerId: string
  side: CombatRole
  /** 0 — стреляет с клетки боя, больше — с поддержки или обстрела. */
  distance: number
  dice: CombatDieRoll[]
  hits: number
}

export interface CombatRoundResult {
  attackerHits: number
  defenderHits: number
  shipRolls: ShipCombatRollLog[]
  /** Урон после раунда, накопленный с начала боя. */
  damageByShipId: Record<string, number>
  /** Уничтожены в этом раунде — с обеих сторон. */
  destroyedShipIds: string[]
}

export interface BattleLogEntry {
  step: 'dice-roll' | 'destruction' | 'no-fire'
  message: string
  data?: Record<string, unknown>
}

export interface CombatSideOptions {
  /**
   * Порядок целей: id вражеских кораблей. Кубики идут на первую цель, пока ожидаемых
   * попаданий не хватит на её добивание, затем на следующую. Остальные цели — по умолчанию.
   */
  targetPriority?: string[]
  /** Явное распределение: id стреляющего → id цели для каждого его кубика по порядку. */
  diceTargets?: Record<string, string[]>
}

export interface CombatOptions {
  attacker?: CombatSideOptions
  defender?: CombatSideOptions
  /** Неучастник выбирает сторону, которой помогают все его доступные корабли. */
  supportSides?: Record<string, CombatRole>
}

/** Мультиплеерная подготовка к бою: порядок целей + взаимная готовность + отсчёт */
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
  /** Атакующий может вместо штурма осадить этот центр власти. */
  siegeAvailable?: boolean
  /** Штурм невозможен — ни одна сторона не может стрелять; остаётся только осада. */
  assaultBlocked?: boolean
  /**
   * Бой на клетке, где уже стоят корабли обеих сторон: вылазка из осады или штурм осаждающими.
   * Атакующие — корабли атакующего на этой клетке.
   */
  assaultFrom?: HexCoord
  /**
   * Ответ осаждённого на только что установленную осаду: нападать необязательно, отмена
   * подготовки — законный отказ. Маркер действия не тратится.
   */
  siegeResponse?: boolean
}

export const COMBAT_PREP_COUNTDOWN_MS = 3000

export interface CombatResolutionResult {
  coord: HexCoord
  /** Победитель боя, если он уже определился; `null` — бой идёт или стороны уничтожили друг друга. */
  winnerId: string | null
  /** На клетке боя не осталось защитников, а у атакующего есть корабли — он входит. */
  attackerWon: boolean
  log: BattleLogEntry[]
  /** Уничтожены в этом раунде — с обеих сторон. */
  destroyedShipIds: string[]
  roundOne?: CombatRoundResult
  rounds?: CombatRoundResult[]
  /** Урон выживших после раунда — переходит в следующий раунд того же боя. */
  damageByShipId?: Record<string, number>
  /** Ни одна сторона не может стрелять: бой невозможен, атакующий не входит. */
  stalemate?: boolean
  /** Раунд брошен, но ждёт перебросов осаждённого (pendingCombat.phase === 'awaiting-rerolls'). */
  paused?: boolean
  /** @deprecated всегда false */
  stub: boolean
}

export interface ShipMoveCombatInput {
  shipId: string
  to: HexCoord
}

export const ONE_BATTLE_PER_MARKER_MSG =
  'В одном приказе маркера можно атаковать только одну клетку боя'

/**
 * Узкий аксессор к фазе подготовки. Читать `pending.prep` напрямую нельзя —
 * поле существует только в варианте `phase: 'prep'`.
 */
export function combatPrepOf(pending: PendingCombat | undefined): CombatPrepState | undefined {
  return pending?.phase === 'prep' ? pending.prep : undefined
}

/**
 * Итог последнего раунда из pendingCombat — чтобы наблюдатели видели броски,
 * даже если lastCombatResult ещё не пришёл или уже очищен.
 */
export function combatResolutionFromPending(
  pending: PendingCombat | null | undefined,
): CombatResolutionResult | null {
  if (!pending || pending.phase !== 'awaiting-continue' || !pending.lastRound) return null
  const [q, r] = pending.cellKey.split(',').map(Number)
  return {
    coord: { q, r },
    winnerId: null,
    attackerWon: false,
    log: [],
    destroyedShipIds: [...pending.lastRound.destroyedShipIds],
    roundOne: pending.lastRound,
    rounds: [pending.lastRound],
    damageByShipId: { ...(pending.damageByShipId ?? {}) },
    stub: false,
  }
}

export function isAwaitingContinue(
  pending: PendingCombat | undefined,
): pending is PendingCombatAwaitingContinue {
  return pending?.phase === 'awaiting-continue'
}

/**
 * Структурные условия, которые обязаны выполняться для любого pendingCombat.
 * Пустой список означает корректное состояние.
 */
export function pendingCombatInvariantViolations(game: GameSnapshot): string[] {
  const pending = game.pendingCombat
  if (!pending) return []
  const violations: string[] = []

  const parts = pending.cellKey.split(',').map(Number)
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
    violations.push(`Некорректный cellKey: ${pending.cellKey}`)
  } else if (!cellAt(game, { q: parts[0]!, r: parts[1]! })) {
    violations.push(`Клетка боя ${pending.cellKey} отсутствует на карте`)
  }

  if (!pending.attackerId) violations.push('Бой без attackerId')
  else if (!game.players.some((p) => p.id === pending.attackerId)) {
    violations.push(`Атакующий ${pending.attackerId} отсутствует среди игроков`)
  }

  switch (pending.phase) {
    case 'prep':
      if (!pending.prep) violations.push('Фаза prep без данных подготовки')
      else if (!pending.prep.defenderId) violations.push('Подготовка без defenderId')
      break
    case 'awaiting-continue':
      if (!pending.continueDecisions) violations.push('Фаза awaiting-continue без continueDecisions')
      if (!pending.defenderIds.length) violations.push('Решение о продолжении без защитников')
      break
    case 'awaiting-rerolls':
      if (!pending.rolledRound?.rerolls) violations.push('Фаза перебросов без перебросов')
      break
    default:
      violations.push(`Неизвестная фаза боя: ${(pending as { phase: string }).phase}`)
  }

  return violations
}

/** Бросает при нарушении инварианта — для тестов и dev-сборки. */
export function assertPendingCombatInvariant(game: GameSnapshot): void {
  const violations = pendingCombatInvariantViolations(game)
  if (violations.length) {
    throw new Error(`Нарушен инвариант pendingCombat: ${violations.join('; ')}`)
  }
}

function pushCombatEvent(game: GameSnapshot, message: string): void {
  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'combat',
    message,
    timestamp: Date.now(),
  })
}

/**
 * Снимает бой, который больше не проходит инвариант. Возвращает список нарушений,
 * чтобы вызывающий мог их залогировать. Без этого невалидный бой блокирует партию.
 */
export function releaseInvalidPendingCombat(game: GameSnapshot): string[] {
  const violations = pendingCombatInvariantViolations(game)
  if (!violations.length) return []
  game.pendingCombat = undefined
  pushCombatEvent(game, `Бой снят автоматически: ${violations.join('; ')}`)
  return violations
}

/**
 * Аварийный выход для участников: снимает зависший бой без применения результата.
 * Корабли остаются там, где стоят.
 */
export function abortPendingCombat(game: GameSnapshot, playerId: string): { errors: string[] } {
  const pending = game.pendingCombat
  if (!pending) return { errors: ['Нет активного боя'] }

  const prep = combatPrepOf(pending)
  const participantIds = new Set<string>([
    pending.attackerId,
    ...pending.defenderIds,
    ...(prep ? [prep.defenderId] : []),
  ])
  if (!participantIds.has(playerId)) {
    return { errors: ['Прервать бой может только участник боя'] }
  }

  game.pendingCombat = undefined
  pushCombatEvent(game, `Бой прерван участником ${playerId}`)
  return { errors: [] }
}

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

/**
 * Поправка к нужному значению на кубике для выстрелов игрока `shooterId` по кораблям игрока
 * `targetOwnerId`. Точка подключения доктрин «Атака» и «Оборона» (фаза 6); сейчас ноль.
 */
export function combatShotModifier(
  game: GameSnapshot,
  shooterId: string,
  targetOwnerId: string | null,
  battleCoord?: HexCoord,
): number {
  return doctrineShotModifier(game, shooterId, targetOwnerId, battleCoord)
}

/** Дальность стрельбы класса: от минимальной до той, где ещё хватает шестёрки. */
export function getFireRangeBounds(type: ShipType, modifier = 0): FireRange {
  return shipFireRange(type, modifier) ?? { min: 0, max: 0 }
}

/** Дальность стрельбы конкретного игрока — с учётом его поправок к броску. */
export function getEffectiveFireRangeBounds(
  game: GameSnapshot,
  type: ShipType,
  shooterId?: string,
  targetOwnerId: string | null = null,
): FireRange {
  const modifier = shooterId ? combatShotModifier(game, shooterId, targetOwnerId) : 0
  return getFireRangeBounds(type, modifier)
}

export function getSupportRange(type: ShipType): number {
  return canShipFireFromDistance(type) ? getFireRangeBounds(type).max : 0
}

/**
 * Стабильный ключ результата боя — для клиента: не перезапускать анимацию бросков
 * при повторной десериализации того же lastCombatResult с сервера.
 */
export function combatResolutionFingerprint(res: CombatResolutionResult | null | undefined): string | null {
  if (!res) return null
  const rollsKey =
    res.rounds?.at(-1)?.shipRolls
      .map((s) => `${s.shipId}:${s.dice.map((d) => `${d.value}>${d.targetShipId ?? '-'}`).join('.')}`)
      .join('|') ?? ''
  return [
    res.coord.q,
    res.coord.r,
    res.attackerWon,
    res.destroyedShipIds.join(','),
    res.rounds?.length ?? 0,
    rollsKey,
  ].join(':')
}

/** Клетка оспариваемая для **движения**: есть любой вражеский корабль. */
export function isCombatDestination(
  game: GameSnapshot,
  attackerId: string,
  dest: HexCoord,
): boolean {
  const cell = cellAt(game, dest)
  if (!cell) return false
  if (siegeAt(game, dest)?.besiegerId === attackerId) return false

  return cell.ships.some((s) => s.ownerId !== attackerId)
}

/** Цель обстрела: любой вражеский корабль или чужой контроль. */
export function isBombardmentDestination(
  game: GameSnapshot,
  attackerId: string,
  dest: HexCoord,
): boolean {
  const cell = cellAt(game, dest)
  if (!cell) return false
  // В осаждённую клетку обстрел не ведут: там стоят вперемешку оба флота.
  if (siegeAt(game, dest)) return false

  const enemyShips = cell.ships.some((s) => s.ownerId !== attackerId)
  const enemyControl = cell.controlOwnerId != null && cell.controlOwnerId !== attackerId
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

/**
 * Мирные ходы того же маркера (не в клетку боя) — для поддержки считаем корабль
 * уже на клетке назначения, даже если физически он ещё на исходной.
 */
export function supportPositionOverridesForMovement(
  plans: ReadonlyArray<{ shipId: string; to: HexCoord }> | undefined,
  combatCoord: HexCoord,
): Map<string, HexCoord> {
  const overrides = new Map<string, HexCoord>()
  if (!plans?.length) return overrides
  const combatKey = hexKey(combatCoord.q, combatCoord.r)
  for (const plan of plans) {
    if (hexKey(plan.to.q, plan.to.r) === combatKey) continue
    overrides.set(plan.shipId, { ...plan.to })
  }
  return overrides
}

/**
 * Где стоят авианосцы игрока для расчёта бонуса: участники боя — на клетке боя (даже если
 * физически ещё на исходной), остальные — на своих клетках с учётом мирных ходов маркера.
 */
function carrierPositions(
  game: GameSnapshot,
  ownerId: string,
  battleCoord: HexCoord,
  battleHexShipIds: ReadonlySet<string>,
  positionOverrides?: ReadonlyMap<string, HexCoord>,
): { shipId: string; coord: HexCoord }[] {
  const out: { shipId: string; coord: HexCoord }[] = []
  for (const cell of game.cells) {
    for (const ship of cell.ships) {
      if (ship.ownerId !== ownerId || ship.type !== 'carrier') continue
      const coord = battleHexShipIds.has(ship.id)
        ? battleCoord
        : positionOverrides?.get(ship.id) ?? cell.coord
      out.push({ shipId: ship.id, coord })
    }
  }
  return out
}

/** Бонус авианосцев стреляющему: лучший из доступных, не складывается, авианосцам не даётся. */
function carrierBonusFor(
  shooter: { id: string; type: ShipType },
  position: HexCoord,
  carriers: readonly { shipId: string; coord: HexCoord }[],
): number {
  if (shooter.type === 'carrier') return 0
  let best = 0
  for (const carrier of carriers) {
    if (carrier.shipId === shooter.id) continue
    best = Math.max(best, carrierBonusAtDistance(hexDistance(carrier.coord, position)))
  }
  return best
}

/**
 * Корабли игрока вне клетки боя, способные стрелять по ней: с каждой клеткой расстояния нужно
 * на 1 больше, выстрел, которому нужно больше шести, невозможен.
 * @param positionOverrides — плановые координаты (мирные ходы маркера до разрешения боя)
 */
export function collectSupportShips(
  game: GameSnapshot,
  battleCoord: HexCoord,
  playerId: string,
  battleHexShipIds: ReadonlySet<string> = new Set(),
  positionOverrides?: ReadonlyMap<string, HexCoord>,
  targetOwnerId: string | null = null,
): CombatSupportShip[] {
  const out: CombatSupportShip[] = []
  const battleKey = hexKey(battleCoord.q, battleCoord.r)
  const modifier = combatShotModifier(game, playerId, targetOwnerId, battleCoord)
  const carriers = carrierPositions(game, playerId, battleCoord, battleHexShipIds, positionOverrides)

  for (const cell of game.cells) {
    for (const ship of cell.ships) {
      if (ship.ownerId !== playerId) continue
      if (battleHexShipIds.has(ship.id)) continue
      const fromCoord = positionOverrides?.get(ship.id) ?? cell.coord
      if (hexKey(fromCoord.q, fromCoord.r) === battleKey) continue
      // Из осаждённой клетки не поддерживают: флоты там связаны друг другом.
      if (siegeAt(game, fromCoord)) continue
      const distance = hexDistance(battleCoord, fromCoord)
      const threshold = shipHitThreshold(ship.type, distance, modifier)
      if (threshold == null) continue
      const bonusDice = carrierBonusFor(ship, fromCoord, carriers)
      out.push({
        shipId: ship.id,
        type: ship.type,
        ownerId: ship.ownerId,
        fromCoord: { ...fromCoord },
        distance,
        dice: shipDice(ship.type) + bonusDice,
        bonusDice,
        threshold,
      })
    }
  }
  return out.sort((a, b) => a.distance - b.distance || a.shipId.localeCompare(b.shipId))
}

function inferDefenderId(
  game: GameSnapshot,
  cell: NonNullable<ReturnType<typeof cellAt>>,
  attackerId: string,
): string | null {
  // Третий игрок, вошедший в осаждённую клетку, бьётся с осаждающим; гарнизон в стороне.
  const siege = siegeAt(game, cell.coord)
  if (siege && attackerId !== siege.besiegerId && attackerId !== siege.besiegedId) {
    return siege.besiegerId
  }
  const owners = distinctOwners(cell.ships.filter((s) => s.ownerId !== attackerId))
  if (owners.length === 1) return owners[0]
  if (cell.controlOwnerId && cell.controlOwnerId !== attackerId) {
    return cell.controlOwnerId
  }
  if (owners.length > 0) return owners[0]
  return null
}

function sideExpectedHits(
  ships: readonly { dice: number; threshold: number | null }[],
): number {
  return ships.reduce((sum, s) => sum + s.dice * hitProbability(s.threshold), 0)
}

function buildSidePreview(
  game: GameSnapshot,
  battleCoord: HexCoord,
  playerId: string,
  role: CombatRole,
  battleHexShips: ShipUnit[],
  enemyOwnerId: string,
  damageByShipId: Readonly<Record<string, number>>,
  assignedSupport: CombatSupportShip[] = [],
  supportPositionOverrides?: ReadonlyMap<string, HexCoord>,
  options: { canFireFromBattleHex?: boolean; collectSupport?: boolean } = {},
): CombatSidePreview {
  const battleHexShipIds = new Set(battleHexShips.map((s) => s.id))
  const modifier = combatShotModifier(game, playerId, enemyOwnerId, battleCoord)
  const carriers = carrierPositions(
    game,
    playerId,
    battleCoord,
    battleHexShipIds,
    supportPositionOverrides,
  )

  const ships: CombatParticipant[] = battleHexShips.map((ship) => {
    const threshold =
      options.canFireFromBattleHex === false ? null : shipHitThreshold(ship.type, 0, modifier)
    const bonusDice = threshold == null ? 0 : carrierBonusFor(ship, battleCoord, carriers)
    return {
      shipId: ship.id,
      type: ship.type,
      ownerId: ship.ownerId,
      side: role,
      hull: shipHullInBattle(ship.type),
      damage: damageByShipId[ship.id] ?? 0,
      dice: threshold == null ? 0 : shipDice(ship.type) + bonusDice,
      bonusDice,
      threshold,
    }
  })

  const supportingShips = [
    ...(options.collectSupport === false
      ? []
      : collectSupportShips(
          game,
          battleCoord,
          playerId,
          battleHexShipIds,
          supportPositionOverrides,
          enemyOwnerId,
        )),
    ...assignedSupport,
  ]

  return {
    playerId,
    role,
    ships,
    supportingShips,
    diceTotal:
      ships.reduce((sum, s) => sum + s.dice, 0)
      + supportingShips.reduce((sum, s) => sum + s.dice, 0),
    expectedHits: sideExpectedHits(ships) + sideExpectedHits(supportingShips),
  }
}

/**
 * Строит превью боя для UI до применения хода.
 * @param incomingAttackerShips — корабли, которые планируется переместить на клетку
 */
export interface BuildCombatPreviewOptions extends Pick<CombatOptions, 'supportSides'> {
  /** Планы движения атакующего: мирные назначения учитываются для поддержки */
  attackerMovementPlans?: ReadonlyArray<{ shipId: string; to: HexCoord }>
  /** Обстрел: оспариваемость по isBombardmentDestination */
  forBombardment?: boolean
  /** Урон, накопленный в текущем бою. */
  damageByShipId?: Readonly<Record<string, number>>
}

export function buildCombatPreview(
  game: GameSnapshot,
  coord: HexCoord,
  attackerId: string,
  incomingAttackerShips: ShipUnit[] = [],
  options: BuildCombatPreviewOptions = {},
): CombatPreview | null {
  const cell = cellAt(game, coord)
  if (!cell) return null

  const contested = options.forBombardment
    ? isBombardmentDestination(game, attackerId, coord)
    : isCombatDestination(game, attackerId, coord)
  if (!contested) return null

  const defenderId = inferDefenderId(game, cell, attackerId)
  if (!defenderId) return null

  const damage = options.damageByShipId ?? {}
  const defenderShips = cell.ships.filter((s) => s.ownerId === defenderId)
  const attackerShips = incomingAttackerShips.filter((s) => s.ownerId === attackerId)
  const attackerSupportOverrides = supportPositionOverridesForMovement(
    options.attackerMovementPlans,
    coord,
  )

  const supportCandidates = new Map<string, CombatSupportShip[]>()
  for (const player of game.players) {
    if (player.eliminated) continue
    if (player.id === attackerId || player.id === defenderId) continue
    const ships = collectSupportShips(game, coord, player.id)
    if (ships.length) supportCandidates.set(player.id, ships)
  }

  // Третий игрок бьётся с осаждающим: гарнизон выбирает сторону и бьётся на клетке сам.
  const contestedSiege = siegeAt(game, coord)
  const garrison = contestedSiege
    && attackerId !== contestedSiege.besiegerId
    && attackerId !== contestedSiege.besiegedId
    && !isEliminatedPlayer(game, contestedSiege.besiegedId)
    ? cell.ships.filter((s) => s.ownerId === contestedSiege.besiegedId)
    : []
  const garrisonOwnerId = garrison.length ? contestedSiege!.besiegedId : null
  if (garrisonOwnerId && !supportCandidates.has(garrisonOwnerId)) supportCandidates.set(garrisonOwnerId, [])
  const garrisonSide = garrisonOwnerId ? options.supportSides?.[garrisonOwnerId] : undefined
  if (garrisonSide === 'attacker') attackerShips.push(...garrison)
  if (garrisonSide === 'defender') defenderShips.push(...garrison)

  const assignedAttackerSupport: CombatSupportShip[] = []
  const assignedDefenderSupport: CombatSupportShip[] = []
  for (const [playerId, ships] of supportCandidates) {
    if (options.supportSides?.[playerId] === 'attacker'
      && canSupportCombatSide(game, 'attacker', attackerId, [defenderId])) {
      assignedAttackerSupport.push(...ships)
    }
    if (options.supportSides?.[playerId] === 'defender'
      && canSupportCombatSide(game, 'defender', attackerId, [defenderId])) {
      assignedDefenderSupport.push(...ships)
    }
  }

  const attackerSide = buildSidePreview(
    game,
    coord,
    attackerId,
    'attacker',
    attackerShips,
    defenderId,
    damage,
    assignedAttackerSupport,
    attackerSupportOverrides,
  )
  const defenderSide = buildSidePreview(
    game,
    coord,
    defenderId,
    'defender',
    defenderShips,
    attackerId,
    damage,
    assignedDefenderSupport,
  )

  // Гарнизон осаждённой клетки перебрасывает промахи — по одному перебросу на корабль в бою.
  const siege = siegeAt(game, coord)
  const garrisonInBattle = siege
    ? [...attackerSide.ships, ...defenderSide.ships].filter((ship) => ship.ownerId === siege.besiegedId).length
    : 0
  const withPool = (side: CombatSidePreview): CombatSidePreview =>
    siege && garrisonInBattle && side.ships.some((ship) => ship.ownerId === siege.besiegedId)
      ? { ...side, rerollPool: garrisonInBattle }
      : side

  return {
    coord,
    coordKey: hexKey(coord.q, coord.r),
    trigger: 'movement',
    attackerId,
    defenderId,
    attacker: withPool(attackerSide),
    defender: withPool(defenderSide),
    ...(siege && garrisonInBattle ? { siegeRerolls: { playerId: siege.besiegedId, pool: garrisonInBattle } } : {}),
    supportCandidates: [...supportCandidates.entries()].map(([playerId, ships]) => ({
      playerId,
      ships,
      ...(playerId === garrisonOwnerId ? { garrisonShipIds: garrison.map((ship) => ship.id) } : {}),
    })),
    notes: [
      'Каждый корабль бросает свои кубики и попадает по порогу своего класса.',
      'Кубики стреляющий распределяет по вражеским кораблям; попадания обеих сторон применяются одновременно.',
      'Поддержка с чужой клетки: +1 к нужному значению за каждую клетку расстояния.',
      'Урон копится до конца боя, после боя выжившие снова целы.',
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
    const defenderId = inferDefenderId(game, cell, attackerId)
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

/** Бросает count кубиков с указанным числом граней. */
export function rollDice(
  count: number,
  faces: number,
  rng: () => number = Math.random,
  fixedValue?: number,
): number[] {
  if (fixedValue != null) {
    return Array.from({ length: count }, () => fixedValue)
  }
  return Array.from({ length: count }, () => Math.floor(rng() * faces) + 1)
}

interface SideShooter {
  shipId: string
  type: ShipType
  ownerId: string
  distance: number
  dice: number
  threshold: number
}

function shootersOf(side: CombatSidePreview): SideShooter[] {
  const out: SideShooter[] = []
  for (const ship of side.ships) {
    if (ship.dice <= 0 || ship.threshold == null) continue
    out.push({
      shipId: ship.shipId,
      type: ship.type,
      ownerId: ship.ownerId,
      distance: 0,
      dice: ship.dice,
      threshold: ship.threshold,
    })
  }
  for (const ship of side.supportingShips) {
    if (ship.dice <= 0) continue
    out.push({
      shipId: ship.shipId,
      type: ship.type,
      ownerId: ship.ownerId,
      distance: ship.distance,
      dice: ship.dice,
      threshold: ship.threshold,
    })
  }
  return out
}

function targetsOf(
  side: CombatSidePreview,
  damageByShipId: Readonly<Record<string, number>>,
): CombatTargetState[] {
  return side.ships
    .map((ship) => ({
      shipId: ship.shipId,
      type: ship.type,
      hull: ship.hull,
      damage: damageByShipId[ship.shipId] ?? ship.damage,
      threat: ship.dice * hitProbability(ship.threshold),
    }))
    .filter((t) => t.damage < t.hull)
}

/** Сколько кубиков сторона может бросить по живым целям противника. */
export function combatSideFirepower(preview: CombatPreview, role: CombatRole): number {
  const side = role === 'attacker' ? preview.attacker : preview.defender
  if (preview.trigger === 'bombardment' && role === 'defender') return 0
  return shootersOf(side).reduce((sum, s) => sum + s.dice, 0)
}

export const UNRESOLVABLE_BATTLE_MSG =
  'Такой бой невозможен: ни одна сторона не может стрелять'

/**
 * Бой, который математически не может закончиться: ни у одной стороны нет выстрела (авианосцы
 * против авианосцев, гиперорудие в упор). Такие бои не начинаются вовсе.
 */
export function isBattleUnresolvable(preview: CombatPreview): boolean {
  if (preview.trigger === 'bombardment') return false
  return combatSideFirepower(preview, 'attacker') === 0 && combatSideFirepower(preview, 'defender') === 0
}

/** Брошенный кубик раунда — до того, как попадания применены. */
export interface RolledCombatDie {
  side: CombatRole
  shooterShipId: string
  shooterType: ShipType
  ownerId: string
  /** 0 — стреляет с клетки боя, больше — поддержка или обстрел. */
  distance: number
  threshold: number
  targetShipId: string | null
  value: number
  /** Прежние значения, если кубик перебрасывали. */
  history: number[]
  /** Кубик гарнизона осаждённой клетки: промах можно перебросить. */
  rerollable: boolean
}

/** Перебросы осаждённого в раунде (ADR 019): по одному на корабль гарнизона в бою. */
export interface CombatRerollPool {
  playerId: string
  left: number
}

export interface RolledCombatRound {
  dice: RolledCombatDie[]
  rerolls: CombatRerollPool | null
}

/**
 * Бросок раунда без подсчёта: обе стороны распределяют кубики по целям и бросают. Перебросы
 * осаждённого ещё не сделаны — их делает игрок (`rerollRolledDie`) или автоматика
 * (`autoRerollMisses`). При обстреле стреляет только атакующий.
 */
export function rollRoundDice(
  preview: CombatPreview,
  damageByShipId: Readonly<Record<string, number>> = {},
  options: CombatOptions = {},
  rng: () => number = Math.random,
  fixedDiceValue?: number,
): RolledCombatRound {
  const dice: RolledCombatDie[] = []
  const sides: CombatSidePreview[] = preview.trigger === 'bombardment'
    ? [preview.attacker]
    : [preview.attacker, preview.defender]

  for (const side of sides) {
    const enemy = side.role === 'attacker' ? preview.defender : preview.attacker
    const targets = targetsOf(enemy, damageByShipId)
    const slots: CombatDieSlot[] = []
    const owners: SideShooter[] = []
    for (const shooter of shootersOf(side)) {
      for (let i = 0; i < shooter.dice; i++) {
        slots.push({ shooterShipId: shooter.shipId, threshold: shooter.threshold })
        owners.push(shooter)
      }
    }
    const sideOptions = side.role === 'attacker' ? options.attacker : options.defender
    const allocation = allocateDice(slots, targets, {
      targetPriority: sideOptions?.targetPriority,
      explicit: sideOptions?.diceTargets,
    })
    slots.forEach((slot, index) => {
      const shooter = owners[index]!
      dice.push({
        side: side.role,
        shooterShipId: shooter.shipId,
        shooterType: shooter.type,
        ownerId: shooter.ownerId,
        distance: shooter.distance,
        threshold: slot.threshold,
        targetShipId: allocation[index] ?? null,
        value: rollDice(1, MAX_DIE_VALUE, rng, fixedDiceValue)[0]!,
        history: [],
        rerollable: false,
      })
    })
  }

  const pool = preview.siegeRerolls
  let rerolls: CombatRerollPool | null = null
  if (pool && pool.pool > 0) {
    for (const die of dice) {
      die.rerollable = die.ownerId === pool.playerId && die.distance === 0 && die.targetShipId != null
    }
    if (dice.some((die) => die.rerollable)) rerolls = { playerId: pool.playerId, left: pool.pool }
  }
  return { dice, rerolls }
}

/** Этот кубик можно перебросить сейчас: он гарнизонный и промахнулся. */
export function canRerollDie(die: RolledCombatDie): boolean {
  return die.rerollable && die.value < die.threshold
}

/** Остались ли перебросы и есть ли что перебрасывать. */
export function rerollsAvailable(rolled: RolledCombatRound): boolean {
  return !!rolled.rerolls && rolled.rerolls.left > 0 && rolled.dice.some(canRerollDie)
}

/** Перебросить один кубик. Видно результат — следующий переброс решается по нему. */
export function rerollRolledDie(
  rolled: RolledCombatRound,
  dieIndex: number,
  roll: () => number,
): string[] {
  const die = rolled.dice[dieIndex]
  if (!rolled.rerolls || rolled.rerolls.left <= 0) return ['Перебросов не осталось']
  if (!die || !die.rerollable) return ['Этот кубик перебрасывать нельзя']
  if (die.value >= die.threshold) return ['Перебрасывать можно только промах']
  die.history.push(die.value)
  die.value = roll()
  rolled.rerolls.left -= 1
  return []
}

/**
 * Перебросы за игрока: сначала каждый промах по одному разу — так больше попаданий в сумме,
 * — потом, если перебросы остались, снова по кругу. Самые точные кубики — первыми.
 */
export function autoRerollMisses(rolled: RolledCombatRound, roll: () => number): void {
  if (!rolled.rerolls) return
  let progressed = true
  while (rolled.rerolls.left > 0 && progressed) {
    progressed = false
    const order = rolled.dice
      .map((die, index) => ({ die, index }))
      .filter(({ die }) => canRerollDie(die))
      .sort((a, b) => a.die.threshold - b.die.threshold || a.index - b.index)
    for (const { index } of order) {
      if (rolled.rerolls.left <= 0) break
      rerollRolledDie(rolled, index, roll)
      progressed = true
    }
  }
}

/** Подсчёт раунда по брошенным кубикам: попадания обеих сторон применяются одновременно. */
export function scoreRolledRound(
  preview: CombatPreview,
  damageByShipId: Readonly<Record<string, number>>,
  rolled: RolledCombatRound,
): CombatRoundResult {
  const shipRolls: ShipCombatRollLog[] = []
  const logs = new Map<string, ShipCombatRollLog>()
  const hitsOn = new Map<string, number>()
  const hitsBySide: Record<CombatRole, number> = { attacker: 0, defender: 0 }

  for (const die of rolled.dice) {
    const hit = die.targetShipId != null && die.value >= die.threshold
    let log = logs.get(die.shooterShipId)
    if (!log) {
      log = {
        shipId: die.shooterShipId,
        shipType: die.shooterType,
        ownerId: die.ownerId,
        side: die.side,
        distance: die.distance,
        dice: [],
        hits: 0,
      }
      logs.set(die.shooterShipId, log)
      shipRolls.push(log)
    }
    log.dice.push({
      value: die.value,
      threshold: die.threshold,
      targetShipId: die.targetShipId,
      hit,
      ...(die.history.length ? { rerolls: [...die.history] } : {}),
    })
    if (hit) {
      log.hits += 1
      hitsBySide[die.side] += 1
      hitsOn.set(die.targetShipId!, (hitsOn.get(die.targetShipId!) ?? 0) + 1)
    }
  }

  const nextDamage: Record<string, number> = { ...damageByShipId }
  const destroyedShipIds: string[] = []
  for (const participant of [...preview.attacker.ships, ...preview.defender.ships]) {
    const hits = hitsOn.get(participant.shipId) ?? 0
    const before = damageByShipId[participant.shipId] ?? participant.damage
    if (before >= participant.hull) continue
    const after = before + hits
    nextDamage[participant.shipId] = after
    if (after >= participant.hull) destroyedShipIds.push(participant.shipId)
  }

  return {
    attackerHits: hitsBySide.attacker,
    defenderHits: hitsBySide.defender,
    shipRolls,
    damageByShipId: nextDamage,
    destroyedShipIds,
  }
}

/**
 * Один раунд целиком: бросок, перебросы осаждённого за него, подсчёт. Для оценки исхода и
 * для случаев, когда решать перебросы некому.
 */
export function rollCombatRound(
  preview: CombatPreview,
  damageByShipId: Readonly<Record<string, number>> = {},
  options: CombatOptions = {},
  rng: () => number = Math.random,
  fixedDiceValue?: number,
): CombatRoundResult {
  const rolled = rollRoundDice(preview, damageByShipId, options, rng, fixedDiceValue)
  autoRerollMisses(rolled, () => rollDice(1, MAX_DIE_VALUE, rng, fixedDiceValue)[0]!)
  return scoreRolledRound(preview, damageByShipId, rolled)
}

/** Человекочитаемая строка итога раунда. */
export function formatCombatRoundSummary(
  round: Pick<CombatRoundResult, 'attackerHits' | 'defenderHits'>,
  roundNumber = 1,
  options?: { bombardment?: boolean },
): string {
  if (options?.bombardment) return `Обстрел — попаданий ${round.attackerHits}`
  return `Раунд ${roundNumber} — попаданий: атакующий ${round.attackerHits}, защитник ${round.defenderHits}`
}

/** Удаляет корабли по id со всех клеток snapshot */
export function removeShipsFromSnapshot(game: GameSnapshot, shipIds: readonly string[]): void {
  if (shipIds.length === 0) return
  const removeSet = new Set(shipIds)
  const touchedKeys = new Set<string>()
  for (const cell of game.cells) {
    const before = cell.ships.length
    cell.ships = cell.ships.filter((s) => !removeSet.has(s.id))
    if (cell.ships.length !== before) touchedKeys.add(hexKey(cell.coord.q, cell.coord.r))
  }
  for (const key of touchedKeys) {
    const [q, r] = key.split(',').map(Number)
    removeOrphanedActionMarkersAt(game, { q, r })
  }
}

/**
 * Маркер действия привязан к игроку: если на клетке не осталось его кораблей —
 * маркер снимается (уничтожение, отступление и т.п.).
 */
export function removeOrphanedActionMarkersAt(game: GameSnapshot, coord: HexCoord): void {
  const cell = cellAt(game, coord)
  if (!cell?.actionMarkerId) return
  const marker = game.actionMarkers.find((candidate) => candidate.id === cell.actionMarkerId)
  if (!marker) {
    cell.actionMarkerId = null
    return
  }
  if (cell.ships.some((ship) => ship.ownerId === marker.ownerId)) return
  game.actionMarkers = game.actionMarkers.filter((candidate) => candidate.id !== marker.id)
  cell.actionMarkerId = null
}

function findShipUnit(game: GameSnapshot, shipId: string): (ShipUnit & { cell: RuntimeCellState }) | null {
  for (const cell of game.cells) {
    const ship = cell.ships.find((s) => s.id === shipId)
    if (ship) return { ...ship, cell }
  }
  return null
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

  if (cell.controlOwnerId == null) return

  if (cell.controlOwnerId !== defenderId) return

  cell.controlOwnerId = attackerId
  removeStaleProductionMarkerAt(game, coord)
}

function shipLabels(ids: readonly string[], preview: CombatPreview): string {
  const byId = new Map(
    [...preview.attacker.ships, ...preview.defender.ships].map((s) => [s.shipId, s.type]),
  )
  return ids
    .map((id) => {
      const type = byId.get(id)
      return type ? SHIP_LABELS[type] : id
    })
    .join(', ')
}

/** Контекст раунда, нужный, чтобы продолжить его после перебросов осаждённого. */
export interface RoundPauseContext {
  trigger: PendingCombat['trigger']
  continuation?: PendingCombat['continuation']
  combatOptions?: CombatOptions
  shipsDestroyedInCombat?: boolean
}

/** Итог раунда: победитель, уничтоженные, урон выживших. */
function resolutionFromRound(
  coord: HexCoord,
  preview: CombatPreview,
  round: CombatRoundResult,
  roundNumber: number,
): CombatResolutionResult {
  const isBombardment = preview.trigger === 'bombardment'
  const log: BattleLogEntry[] = [
    {
      step: 'dice-roll',
      message: formatCombatRoundSummary(round, roundNumber, { bombardment: isBombardment }),
      data: { round, roundNumber },
    },
  ]

  const destroyed = new Set(round.destroyedShipIds)
  log.push({
    step: 'destruction',
    message: destroyed.size
      ? `Уничтожены: ${shipLabels(round.destroyedShipIds, preview)}`
      : 'Уничтожений нет',
    data: { destroyedShipIds: round.destroyedShipIds },
  })

  // Исход решают корабли самих сторон: союзный гарнизон бой за них не выигрывает.
  const alive = (side: CombatSidePreview) =>
    side.ships.filter((s) => s.ownerId === side.playerId && !destroyed.has(s.shipId)).length
  const defendersLeft = alive(preview.defender)
  const attackersLeft = alive(preview.attacker)
  const attackerWon = defendersLeft === 0 && (isBombardment || attackersLeft > 0)
  const defenderWon = !isBombardment && attackersLeft === 0 && defendersLeft > 0
  const winnerId = attackerWon ? preview.attackerId : defenderWon ? preview.defenderId : null

  const survivingDamage: Record<string, number> = {}
  for (const [shipId, damage] of Object.entries(round.damageByShipId)) {
    if (!destroyed.has(shipId) && damage > 0) survivingDamage[shipId] = damage
  }

  return {
    coord,
    winnerId,
    attackerWon,
    log,
    destroyedShipIds: [...round.destroyedShipIds],
    roundOne: round,
    rounds: [round],
    damageByShipId: survivingDamage,
    stub: false,
  }
}

/**
 * Один раунд боя на клетке. Не перемещает корабли — возвращает уничтоженные с обеих сторон,
 * накопленный урон выживших и исход, если бой им решился.
 *
 * Если в бою гарнизон осаждённой клетки и передан `pause`, после броска раунд встаёт:
 * `pendingCombat` переходит в `awaiting-rerolls`, осаждённый перебрасывает промахи сам
 * (`rerollCombatDie`, `finishCombatRerolls`), а результат возвращается с `paused`.
 *
 * @param damageByShipId — урон, накопленный в предыдущих раундах этого же боя
 */
export function resolveCombatAtCell(
  game: GameSnapshot,
  coord: HexCoord,
  attackerId: string,
  incomingAttackerShips: ShipUnit[] = [],
  options: CombatOptions = {},
  rng: () => number = Math.random,
  previewOverride?: CombatPreview,
  damageByShipId: Readonly<Record<string, number>> = {},
  roundNumber = 1,
  pause?: RoundPauseContext,
): CombatResolutionResult {
  const preview =
    previewOverride
    ?? buildCombatPreview(game, coord, attackerId, incomingAttackerShips, {
      supportSides: options.supportSides,
      damageByShipId,
    })

  if (!preview) {
    return {
      coord,
      winnerId: null,
      attackerWon: false,
      log: [{ step: 'no-fire', message: 'Нет боя на этой клетке' }],
      destroyedShipIds: [],
      stub: false,
    }
  }

  const attackerFire = combatSideFirepower(preview, 'attacker')
  const defenderFire = combatSideFirepower(preview, 'defender')
  if (attackerFire === 0 && defenderFire === 0) {
    return {
      coord,
      winnerId: null,
      attackerWon: false,
      log: [{ step: 'no-fire', message: 'Ни одна сторона не может стрелять — бой не состоялся' }],
      destroyedShipIds: [],
      damageByShipId: { ...damageByShipId },
      stalemate: true,
      stub: false,
    }
  }

  const rolled = rollRoundDice(preview, damageByShipId, options, rng, game.scriptedDiceValue)
  if (pause && rerollsAvailable(rolled) && !isEliminatedPlayer(game, rolled.rerolls!.playerId)) {
    game.pendingCombat = {
      cellKey: hexKey(coord.q, coord.r),
      attackerId,
      defenderIds: defenderIdsOnCell(game, coord, attackerId),
      roundNumber,
      phase: 'awaiting-rerolls',
      trigger: pause.trigger,
      continuation: pause.continuation,
      ...(pause.combatOptions ? { combatOptions: pause.combatOptions } : {}),
      shipsDestroyedInCombat: pause.shipsDestroyedInCombat ?? false,
      damageByShipId: { ...damageByShipId },
      rolledRound: rolled,
    }
    pushCombatEvent(game, `Раунд ${roundNumber}: осаждённый перебрасывает промахи`)
    return {
      coord,
      winnerId: null,
      attackerWon: false,
      log: [{ step: 'dice-roll', message: 'Осаждённый перебрасывает промахи' }],
      destroyedShipIds: [],
      damageByShipId: { ...damageByShipId },
      paused: true,
      stub: false,
    }
  }

  autoRerollMisses(rolled, () => rollDice(1, MAX_DIE_VALUE, rng, game.scriptedDiceValue)[0]!)
  const round = scoreRolledRound(preview, damageByShipId, rolled)
  return resolutionFromRound(coord, preview, round, roundNumber)
}

export const REROLL_ERRORS = {
  none: 'Сейчас перебрасывать нечего',
  notYours: 'Перебрасывает осаждённый',
} as const

/** Осаждённый перебрасывает один свой промах. Когда перебрасывать больше нечего — раунд идёт дальше. */
export function rerollCombatDie(
  game: GameSnapshot,
  playerId: string,
  dieIndex: unknown,
  rng: () => number = Math.random,
): { errors: string[]; combatResult?: CombatResolutionResult; combatVanished?: boolean } {
  const pending = game.pendingCombat
  if (pending?.phase !== 'awaiting-rerolls') return { errors: [REROLL_ERRORS.none] }
  if (pending.rolledRound.rerolls?.playerId !== playerId) return { errors: [REROLL_ERRORS.notYours] }
  if (typeof dieIndex !== 'number' || !Number.isInteger(dieIndex)) {
    return { errors: ['Не удалось выполнить действие — обновите страницу и попробуйте снова'] }
  }
  const errors = rerollRolledDie(
    pending.rolledRound,
    dieIndex,
    () => rollDice(1, MAX_DIE_VALUE, rng, game.scriptedDiceValue)[0]!,
  )
  if (errors.length) return { errors }
  if (rerollsAvailable(pending.rolledRound)) return { errors: [] }
  return completeCombatRerolls(game, rng)
}

/**
 * Осаждённый закончил перебрасывать. `auto` — оставшиеся перебросы раздаёт игра (боты,
 * выбывший игрок); без него неиспользованные перебросы сгорают.
 */
export function finishCombatRerolls(
  game: GameSnapshot,
  playerId: string,
  options: { auto?: boolean } = {},
  rng: () => number = Math.random,
): { errors: string[]; combatResult?: CombatResolutionResult; combatVanished?: boolean } {
  const pending = game.pendingCombat
  if (pending?.phase !== 'awaiting-rerolls') return { errors: [REROLL_ERRORS.none] }
  if (pending.rolledRound.rerolls?.playerId !== playerId) return { errors: [REROLL_ERRORS.notYours] }
  if (options.auto) {
    autoRerollMisses(pending.rolledRound, () => rollDice(1, MAX_DIE_VALUE, rng, game.scriptedDiceValue)[0]!)
  }
  return completeCombatRerolls(game, rng)
}

/** Подсчитать отложенный раунд и вести бой дальше — как после обычного раунда. */
function completeCombatRerolls(
  game: GameSnapshot,
  rng: () => number,
): { errors: string[]; combatResult?: CombatResolutionResult; combatVanished?: boolean } {
  const pending = game.pendingCombat
  if (pending?.phase !== 'awaiting-rerolls') return { errors: [REROLL_ERRORS.none] }
  const [q, r] = pending.cellKey.split(',').map(Number)
  const coord = { q: q!, r: r! }
  const damageBefore = { ...(pending.damageByShipId ?? {}) }
  const incoming = incomingShipsForPendingContinuation(game, pending)
  const preview = buildCombatPreview(game, coord, pending.attackerId, incoming, {
    attackerMovementPlans: pending.continuation?.movementPlans,
    supportSides: pending.combatOptions?.supportSides,
    damageByShipId: damageBefore,
  })
  if (!preview) {
    game.pendingCombat = undefined
    return { errors: [], combatVanished: true }
  }
  const round = scoreRolledRound(preview, damageBefore, pending.rolledRound)
  const result = resolutionFromRound(coord, preview, round, pending.roundNumber)
  applyCombatResultToSnapshot(game, result, pending.attackerId, preview.defenderId)
  game.pendingCombat = undefined
  const followUp = beginOrAwaitCombatContinuation(
    game,
    {
      coord,
      attackerId: pending.attackerId,
      completedRoundNumber: pending.roundNumber,
      trigger: pending.trigger,
      continuation: pending.continuation,
      combatOptions: pending.combatOptions,
      shipsDestroyedInCombat: (pending.shipsDestroyedInCombat ?? false) || result.destroyedShipIds.length > 0,
      damageByShipId: result.damageByShipId,
      seedCombatResult: result,
    },
    rng,
  )
  return {
    errors: followUp.errors,
    combatResult: followUp.combatResult ?? result,
    combatVanished: followUp.combatVanished,
  }
}

/** Проверка combatOptions в pendingCombat.prep до старта боя или countdown */
export function validatePendingCombatPrepOptions(game: GameSnapshot): string[] {
  const pending = game.pendingCombat
  const prep = combatPrepOf(pending)
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

  if (prep.assaultFrom) {
    const preview = buildCombatPreview(game, coord, attackerId, attackerShipsAt(game, coord, attackerId))
    if (!preview) return ['Не удалось проверить параметры боя']
    return validateCombatOptions(game, preview, [], opts)
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

function validateTargetPriority(
  priority: readonly string[] | undefined,
  enemyShipIds: ReadonlySet<string>,
): string[] {
  if (!priority?.length) return []
  const seen = new Set<string>()
  for (const id of priority) {
    if (seen.has(id)) return ['Одна и та же цель указана дважды']
    seen.add(id)
    if (!enemyShipIds.has(id)) return ['В порядке целей указан корабль, который не участвует в бою']
  }
  return []
}

/**
 * Проверка порядка целей. Явное распределение кубиков не проверяется: цели в нём устаревают
 * от раунда к раунду, поэтому несуществующие назначения просто пропускаются.
 */
export function validateCombatOptions(
  _game: GameSnapshot,
  preview: CombatPreview,
  _incomingAttackerShipIds: readonly string[],
  options: CombatOptions = {},
): string[] {
  const defenderShipIds = new Set(preview.defender.ships.map((s) => s.shipId))
  const attackerShipIds = new Set(preview.attacker.ships.map((s) => s.shipId))
  return [
    ...validateTargetPriority(options.attacker?.targetPriority, defenderShipIds),
    ...validateTargetPriority(options.defender?.targetPriority, attackerShipIds),
  ]
}

/** Применяет результат боя к snapshot: удаление кораблей, захват клетки при победе атакующего */
export interface ApplyCombatResultOptions {
  /** false для обстрела — атакующий не занимает клетку */
  transferControl?: boolean
  /** Корабли атакующего, ещё не вошедшие на клетку (движение до высадки) */
  incomingAttackerShips?: ShipUnit[]
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
    maybeTransferControl(
      game,
      result.coord,
      attackerId,
      defenderId,
    )
  }
  // Маркер клетки боя: если у владельца не осталось кораблей — снять
  // (не только при победе атакующего и не только для «защитника» FSM).
  removeOrphanedActionMarkersAt(game, result.coord)
}

/** Вероятности исхода боя целиком (перспектива атакующего) */
export interface BattleOutcomeOdds {
  /** Атакующий уничтожил защитников и выжил. */
  win: number
  /** Взаимное уничтожение или бой, который никто не может выиграть. */
  draw: number
  /** Атакующий уничтожен. */
  defeat: number
}

/**
 * Monte-Carlo оценка исхода боя «до конца», без отступлений: раунды идут, пока одна из
 * сторон не лишится кораблей на клетке. Поддержка и бонусы берутся из превью как есть.
 */
export function estimateBattleOutcome(
  preview: CombatPreview,
  options?: { samples?: number; rng?: () => number; maxRounds?: number },
): BattleOutcomeOdds {
  const samples = options?.samples ?? 400
  const rng = options?.rng ?? Math.random
  const maxRounds = options?.maxRounds ?? 30

  if (
    combatSideFirepower(preview, 'attacker') === 0
    && combatSideFirepower(preview, 'defender') === 0
  ) {
    return { win: 0, draw: 1, defeat: 0 }
  }

  let wins = 0
  let draws = 0
  let defeats = 0

  for (let i = 0; i < samples; i++) {
    let damage: Record<string, number> = {}
    for (const ship of [...preview.attacker.ships, ...preview.defender.ships]) {
      if (ship.damage > 0) damage[ship.shipId] = ship.damage
    }
    let outcome: 'win' | 'draw' | 'defeat' = 'draw'
    for (let round = 0; round < maxRounds; round++) {
      const result = rollCombatRound(preview, damage, {}, rng)
      damage = result.damageByShipId
      const alive = (side: CombatSidePreview) =>
        side.ships.some((s) => (damage[s.shipId] ?? 0) < s.hull)
      const attackersAlive = preview.trigger === 'bombardment' || alive(preview.attacker)
      const defendersAlive = alive(preview.defender)
      if (!defendersAlive && attackersAlive) outcome = 'win'
      else if (!attackersAlive && defendersAlive) outcome = 'defeat'
      else if (!attackersAlive && !defendersAlive) outcome = 'draw'
      else if (preview.trigger !== 'bombardment') continue
      break
    }
    if (outcome === 'win') wins++
    else if (outcome === 'defeat') defeats++
    else draws++
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
  // Третий игрок в осаждённой клетке бьётся только с осаждающим: гарнизон в его бою не участвует.
  const siege = siegeAt(game, coord)
  if (siege && attackerId !== siege.besiegerId && attackerId !== siege.besiegedId) {
    return cell.ships.some((s) => s.ownerId === siege.besiegerId) ? [siege.besiegerId] : []
  }
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
  if (!continuation) {
    // Бой на общей клетке (вылазка, штурм осады): атакующие уже стоят на клетке боя.
    const [q, r] = pending.cellKey.split(',').map(Number)
    return cellAt(game, { q, r })?.ships.filter((ship) => ship.ownerId === pending.attackerId) ?? []
  }
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

/** Отступление доступно только после первого уничтожения корабля в этом бою. */
export function isCombatRetreatAllowed(pending: PendingCombat | undefined): boolean {
  return pending?.shipsDestroyedInCombat === true
}

export function getCombatRetreatDestinations(
  game: GameSnapshot,
  playerId: string,
): HexCoord[] {
  const pending = game.pendingCombat
  if (!isAwaitingContinue(pending)) return []
  if (!isCombatRetreatAllowed(pending)) return []
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

export function setupPendingCombat(
  game: GameSnapshot,
  coord: HexCoord,
  attackerId: string,
  roundNumber: number,
  trigger: PendingCombat['trigger'] = 'movement',
  continuation?: PendingCombat['continuation'],
  options?: {
    shipsDestroyedInCombat?: boolean
    damageByShipId?: Record<string, number>
    lastRound?: CombatRoundResult
  },
): void {
  game.pendingCombat = {
    cellKey: hexKey(coord.q, coord.r),
    attackerId,
    defenderIds: defenderIdsOnCell(game, coord, attackerId),
    roundNumber,
    phase: 'awaiting-continue',
    continueDecisions: {},
    trigger,
    continuation,
    shipsDestroyedInCombat: options?.shipsDestroyedInCombat ?? false,
    damageByShipId: { ...(options?.damageByShipId ?? {}) },
    ...(options?.lastRound ? { lastRound: options.lastRound } : {}),
  }
}

/** Защитный потолок раундов одного боя: бой без решений людей не должен крутиться вечно. */
const MAX_COMBAT_ROUNDS = 64

type ContinuedRoundStep = {
  errors: string[]
  combatResult?: CombatResolutionResult
  combatVanished?: boolean
  shipsDestroyedInCombat: boolean
  completedRoundNumber: number
  shouldContinue: boolean
  combatOptions?: CombatOptions
  damageByShipId: Record<string, number>
  /** Раунд брошен и ждёт перебросов осаждённого — pendingCombat уже в awaiting-rerolls. */
  paused?: boolean
}

/** Опции следующего раунда: цели выбираются заново, порядок целей и поддержка остаются. */
function optionsForNextRound(options: CombatOptions | undefined): CombatOptions | undefined {
  if (!options) return undefined
  const side = (s: CombatSideOptions | undefined): CombatSideOptions | undefined => {
    if (!s) return undefined
    const { diceTargets: _dropped, ...rest } = s
    return Object.keys(rest).length ? rest : undefined
  }
  const next: CombatOptions = { ...options }
  const attacker = side(options.attacker)
  const defender = side(options.defender)
  if (attacker) next.attacker = attacker
  else delete next.attacker
  if (defender) next.defender = defender
  else delete next.defender
  return next
}

/**
 * Третьи игроки, чьи корабли стреляют в этом бою: перед раундом они тоже выбирают цели.
 * Выбывшие не спрашиваются — их кубики раздаёт игра.
 */
export function combatSupportersAwaited(game: GameSnapshot, preview: CombatPreview | null): string[] {
  const pending = game.pendingCombat
  if (!pending || !preview) return []
  const main = new Set([pending.attackerId, ...pending.defenderIds])
  const out = new Set<string>()
  for (const side of [preview.attacker, preview.defender]) {
    for (const ship of [...side.supportingShips, ...side.ships]) {
      if (main.has(ship.ownerId) || ship.dice <= 0) continue
      if (isEliminatedPlayer(game, ship.ownerId)) continue
      out.add(ship.ownerId)
    }
  }
  return [...out]
}

/** Все, кто решает перед раундом, решили: можно бросать. */
function roundReadyToRoll(game: GameSnapshot): boolean {
  const pending = game.pendingCombat
  if (!isAwaitingContinue(pending)) return false
  if (pending.continueDecisions.attacker !== true || pending.continueDecisions.defender !== true) {
    return false
  }
  const supporters = combatSupportersAwaited(game, buildCombatPreviewFromPending(game))
  return supporters.every((playerId) => pending.supportReady?.[playerId] === true)
}

/**
 * После раунда: если бой продолжается, стороны снова выбирают цели и решают, продолжать ли.
 * Пока в бою никто не уничтожен, отступать нельзя — остаётся только выбрать цели.
 */
export function beginOrAwaitCombatContinuation(
  game: GameSnapshot,
  args: {
    coord: HexCoord
    attackerId: string
    /** Номер только что завершённого раунда */
    completedRoundNumber: number
    trigger?: PendingCombat['trigger']
    continuation?: PendingCombat['continuation']
    combatOptions?: CombatOptions
    shipsDestroyedInCombat: boolean
    /** Урон, накопленный к концу завершённого раунда */
    damageByShipId?: Record<string, number>
    /** Результат только что сыгранного раунда (чтобы не потерять его при конце боя) */
    seedCombatResult?: CombatResolutionResult
  },
  rng: () => number = Math.random,
): { errors: string[]; combatResult?: CombatResolutionResult; combatVanished?: boolean } {
  const lastResult = args.seedCombatResult
  const damageByShipId = { ...(args.damageByShipId ?? lastResult?.damageByShipId ?? {}) }

  const shouldContinue = !lastResult?.stalemate && (
    args.continuation
      ? combatShouldContinueWithIncomingShips(
          game,
          args.coord,
          args.attackerId,
          args.continuation.incomingAttackerShipIds,
        )
      : combatShouldContinueAfterRound(game, args.coord, args.attackerId)
  )
  if (!shouldContinue || args.completedRoundNumber >= MAX_COMBAT_ROUNDS) {
    game.pendingCombat = undefined
    return { errors: [], combatResult: lastResult }
  }

  setupPendingCombat(
    game,
    args.coord,
    args.attackerId,
    args.completedRoundNumber + 1,
    args.trigger,
    args.continuation,
    {
      shipsDestroyedInCombat: args.shipsDestroyedInCombat,
      damageByShipId,
      lastRound: lastResult?.rounds?.at(-1),
    },
  )
  const nextOptions = optionsForNextRound(args.combatOptions)
  if (nextOptions) game.pendingCombat!.combatOptions = nextOptions

  // Бой без живых решающих (сдались оба) дожимается сам.
  applyEliminatedContinueDefaults(game)
  if (roundReadyToRoll(game)) {
    const auto = finishContinueAfterBothSidesReady(game, rng)
    return {
      errors: auto.errors,
      combatResult: auto.combatResult ?? lastResult,
      combatVanished: auto.combatVanished,
    }
  }
  return { errors: [], combatResult: lastResult }
}

/** Исполнение одного раунда, когда все решения перед ним приняты. */
function executeContinuedCombatRound(
  game: GameSnapshot,
  rng: () => number,
): ContinuedRoundStep {
  const pending = game.pendingCombat
  if (!isAwaitingContinue(pending)) {
    return {
      errors: ['Нет незавершённого боя'],
      shipsDestroyedInCombat: false,
      completedRoundNumber: 0,
      shouldContinue: false,
      damageByShipId: {},
    }
  }

  const [q, r] = pending.cellKey.split(',').map(Number)
  const coord = { q, r }
  const damageBefore = { ...(pending.damageByShipId ?? {}) }
  const incomingShips = incomingShipsForPendingContinuation(game, pending)
  const opts = pending.combatOptions
  const preview = buildCombatPreview(game, coord, pending.attackerId, incomingShips, {
    attackerMovementPlans: pending.continuation?.movementPlans,
    supportSides: opts?.supportSides,
    damageByShipId: damageBefore,
  })
  if (!preview) {
    if (!defenderIdsOnCell(game, coord, pending.attackerId).length) {
      game.pendingCombat = undefined
      return {
        errors: [],
        combatVanished: true,
        shipsDestroyedInCombat: pending.shipsDestroyedInCombat === true,
        completedRoundNumber: pending.roundNumber,
        shouldContinue: false,
        damageByShipId: damageBefore,
      }
    }
    return {
      errors: ['Не удалось продолжить бой: нет превью сражения'],
      shipsDestroyedInCombat: pending.shipsDestroyedInCombat === true,
      completedRoundNumber: pending.roundNumber,
      shouldContinue: false,
      damageByShipId: damageBefore,
    }
  }

  const result = resolveCombatAtCell(
    game,
    coord,
    pending.attackerId,
    incomingShips,
    opts,
    rng,
    preview,
    damageBefore,
    pending.roundNumber,
    {
      trigger: pending.trigger,
      continuation: pending.continuation,
      combatOptions: opts,
      shipsDestroyedInCombat: pending.shipsDestroyedInCombat,
    },
  )
  if (result.paused) {
    return {
      errors: [],
      paused: true,
      shipsDestroyedInCombat: pending.shipsDestroyedInCombat === true,
      completedRoundNumber: pending.roundNumber,
      shouldContinue: false,
      damageByShipId: damageBefore,
    }
  }

  const shipsDestroyedInCombat =
    (pending.shipsDestroyedInCombat ?? false) || result.destroyedShipIds.length > 0
  const completedRoundNumber = pending.roundNumber
  const continuation = pending.continuation
  const attackerId = pending.attackerId

  applyCombatResultToSnapshot(game, result, attackerId, preview.defenderId)

  const shouldContinue = !result.stalemate && (
    continuation
      ? combatShouldContinueWithIncomingShips(
          game,
          coord,
          attackerId,
          continuation.incomingAttackerShipIds,
        )
      : combatShouldContinueAfterRound(game, coord, attackerId)
  )

  // Следующий pending ставит beginOrAwaitCombatContinuation.
  game.pendingCombat = undefined

  return {
    errors: [],
    combatResult: result,
    shipsDestroyedInCombat,
    completedRoundNumber,
    shouldContinue,
    combatOptions: opts,
    damageByShipId: result.damageByShipId ?? damageBefore,
  }
}

/** После выбытия: дожать бой без действий выбывшего. */
export function syncEliminatedCombatAutomation(
  game: GameSnapshot,
  rng: () => number = Math.random,
): { combatResult?: CombatResolutionResult } {
  const pending = game.pendingCombat
  // Выбывший осаждённый перебрасывать не будет — остаток перебросов раздаёт игра.
  if (pending?.phase === 'awaiting-rerolls') {
    const owner = pending.rolledRound.rerolls?.playerId
    if (owner && isEliminatedPlayer(game, owner)) {
      return { combatResult: finishCombatRerolls(game, owner, { auto: true }, rng).combatResult }
    }
    return {}
  }
  if (!isAwaitingContinue(pending)) return {}
  applyEliminatedContinueDefaults(game)
  if (roundReadyToRoll(game)) return { combatResult: finishContinueAfterBothSidesReady(game, rng).combatResult }
  return {}
}

/**
 * Решение перед раундом: выбранные цели и «продолжить». Цели можно не присылать — тогда кубики
 * игрока раздаст игра. Атакующий, защитник и поддерживающие решают независимо; только после
 * первого уничтожения защитник ждёт решения атакующего — он вправе отступить, узнав его.
 */
export function continuePendingCombat(
  game: GameSnapshot,
  playerId: string,
  options: { diceTargets?: unknown } = {},
  rng: () => number = Math.random,
): { errors: string[]; combatResult?: CombatResolutionResult; combatVanished?: boolean } {
  const pending = game.pendingCombat
  if (!isAwaitingContinue(pending)) return { errors: ['Нет незавершённого боя'] }

  const preview = buildCombatPreviewFromPending(game)
  const isAttacker = playerId === pending.attackerId
  const isDefender = playerId === pending.defenderIds[0]
  const isSupporter = !isAttacker && !isDefender
    && combatSupportersAwaited(game, preview).includes(playerId)
  if (!isAttacker && !isDefender && !isSupporter) {
    return { errors: ['Продолжить бой может только участник боя'] }
  }
  if (isEliminatedPlayer(game, playerId)) {
    return { errors: ['Выбывший игрок не решает продолжение боя'] }
  }

  if (isAttacker && pending.continueDecisions.attacker != null) {
    return { errors: ['Атакующий уже выбрал продолжение боя'] }
  }
  if (isDefender) {
    if (isCombatRetreatAllowed(pending) && pending.continueDecisions.attacker !== true) {
      return { errors: ['Сначала решение о продолжении принимает атакующий'] }
    }
    if (pending.continueDecisions.defender != null) {
      return { errors: ['Защитник уже выбрал продолжение боя'] }
    }
  }
  if (isSupporter && pending.supportReady?.[playerId] === true) {
    return { errors: ['Вы уже подтвердили цели на этот раунд'] }
  }

  if (options.diceTargets != null && preview) {
    const errors = mergePlayerDiceTargets(
      pending,
      preview,
      playerId,
      options.diceTargets,
      pending.damageByShipId ?? {},
    )
    if (errors.length) return { errors }
  }

  if (isAttacker) pending.continueDecisions = { ...pending.continueDecisions, attacker: true }
  else if (isDefender) pending.continueDecisions = { ...pending.continueDecisions, defender: true }
  else pending.supportReady = { ...pending.supportReady, [playerId]: true }

  applyEliminatedContinueDefaults(game)
  if (roundReadyToRoll(game)) return finishContinueAfterBothSidesReady(game, rng)
  return { errors: [] }
}

/** Записать выбор целей игрока в опции его стороны. */
function mergePlayerDiceTargets(
  holder: { combatOptions?: CombatOptions },
  preview: CombatPreview,
  playerId: string,
  raw: unknown,
  damageByShipId: Readonly<Record<string, number>>,
): string[] {
  const role = combatSideOfPlayer(preview, playerId)
  if (!role) return ['Вашим кораблям в этом бою нечем стрелять']
  const { errors, value } = validateDiceTargets(preview, playerId, raw, damageByShipId)
  if (errors.length) return errors
  const options: CombatOptions = holder.combatOptions ?? {}
  const own = new Set(playerCombatDice(preview, playerId).map((die) => die.shooterShipId))
  const kept = Object.fromEntries(
    Object.entries(options[role]?.diceTargets ?? {}).filter(([shooterId]) => !own.has(shooterId)),
  )
  options[role] = { ...options[role], diceTargets: { ...kept, ...value } }
  holder.combatOptions = options
  return []
}

function applyEliminatedContinueDefaults(game: GameSnapshot): void {
  const pending = game.pendingCombat
  if (!isAwaitingContinue(pending)) return
  if (isEliminatedPlayer(game, pending.attackerId)) {
    pending.continueDecisions = { ...pending.continueDecisions, attacker: true }
  }
  const defenderId = pending.defenderIds[0]
  if (defenderId && isEliminatedPlayer(game, defenderId) && pending.continueDecisions?.attacker === true) {
    pending.continueDecisions = { ...pending.continueDecisions, defender: true }
  }
}

function finishContinueAfterBothSidesReady(
  game: GameSnapshot,
  rng: () => number,
): { errors: string[]; combatResult?: CombatResolutionResult; combatVanished?: boolean } {
  const pending = game.pendingCombat
  if (!isAwaitingContinue(pending)) return { errors: ['Нет незавершённого боя'] }

  const [q, r] = pending.cellKey.split(',').map(Number)
  const attackerId = pending.attackerId
  const trigger = pending.trigger
  const continuation = pending.continuation

  const step = executeContinuedCombatRound(game, rng)
  if (step.errors.length) {
    return { errors: step.errors, combatResult: step.combatResult }
  }
  if (step.paused) return { errors: [] }
  if (step.combatVanished) {
    return { errors: [], combatResult: step.combatResult, combatVanished: true }
  }

  const followUp = beginOrAwaitCombatContinuation(
    game,
    {
      coord: { q, r },
      attackerId,
      completedRoundNumber: step.completedRoundNumber,
      trigger,
      continuation,
      combatOptions: step.combatOptions,
      shipsDestroyedInCombat: step.shipsDestroyedInCombat,
      damageByShipId: step.damageByShipId,
      seedCombatResult: step.combatResult,
    },
    rng,
  )
  return {
    errors: followUp.errors,
    combatResult: followUp.combatResult ?? step.combatResult,
    combatVanished: followUp.combatVanished,
  }
}

export function stopPendingCombat(
  game: GameSnapshot,
  playerId: string,
  retreatTo?: HexCoord,
): string[] {
  const pending = game.pendingCombat
  if (!isAwaitingContinue(pending)) return []
  if (isEliminatedPlayer(game, playerId)) {
    return ['Выбывший игрок не может отступить']
  }
  const defenderId = pending.defenderIds[0]
  const isAttacker = pending.attackerId === playerId
  const isDefender = defenderId === playerId
  if (!isAttacker && !isDefender) return ['Остановить бой может только участник боя']
  if (isDefender && pending.continueDecisions?.attacker !== true) {
    return ['Сначала решение о продолжении принимает атакующий']
  }
  if (!isCombatRetreatAllowed(pending)) {
    return ['Отступление недоступно, пока в этом бою не уничтожен ни один корабль']
  }
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
  transferControlIfEnemyOwned(game, destination, playerId)
  // Отступление / уход флота: маркер владельца без кораблей на клетке боя снимается.
  removeOrphanedActionMarkersAt(game, { q, r })
  game.pendingCombat = undefined
  pushCombatEvent(
    game,
    `${isAttacker ? 'Атакующий' : 'Защитник'} отступил в (${retreatTo.q},${retreatTo.r})`,
  )
  return []
}

function attackerShipsAt(game: GameSnapshot, coord: HexCoord, attackerId: string): ShipUnit[] {
  return cellAt(game, coord)?.ships.filter((ship) => ship.ownerId === attackerId) ?? []
}

/** Превью боя из pendingCombat — по текущей фазе */
export function buildCombatPreviewFromPending(game: GameSnapshot): CombatPreview | null {
  const pending = game.pendingCombat
  if (!pending) return null
  const [q, r] = pending.cellKey.split(',').map(Number)
  const coord = { q, r }

  if (pending.phase === 'prep') {
    const prep = pending.prep
    if (prep.assaultFrom) {
      return buildCombatPreview(game, coord, pending.attackerId, attackerShipsAt(game, coord, pending.attackerId), {
        supportSides: prep.combatOptions.supportSides,
      })
    }
    if (pending.trigger === 'bombardment' && prep.bombardmentFrom && prep.bombardmentPlans?.length) {
      const fromCell = cellAt(game, prep.bombardmentFrom)
      if (!fromCell) return null
      const bombardingShips = prep.bombardmentPlans
        .map((p) => fromCell.ships.find((s) => s.id === p.shipId))
        .filter((s): s is ShipUnit => !!s)
      return buildBombardmentPreview(game, coord, pending.attackerId, bombardingShips, prep.bombardmentFrom)
    }
    const fromCell = prep.movementFrom ? cellAt(game, prep.movementFrom) : undefined
    const incomingShips = (prep.incomingAttackerShipIds ?? [])
      .map((id) => fromCell?.ships.find((s) => s.id === id))
      .filter((s): s is ShipUnit => !!s)
    return buildCombatPreview(game, coord, pending.attackerId, incomingShips, {
      ...prep.combatOptions,
      attackerMovementPlans: prep.movementPlans,
    })
  }

  return buildCombatPreview(
    game,
    coord,
    pending.attackerId,
    incomingShipsForPendingContinuation(game, pending),
    {
      attackerMovementPlans: pending.continuation?.movementPlans,
      supportSides: pending.combatOptions?.supportSides,
      damageByShipId: pending.damageByShipId,
    },
  )
}

export function setupCombatPrepForMovement(
  game: GameSnapshot,
  from: HexCoord,
  moves: import('./movement.js').ShipMovePlan[],
  playerId: string,
  combatCoord: HexCoord,
  incomingShipIds: string[],
): string[] {
  const fromCell = cellAt(game, from)
  const incomingShips = incomingShipIds
    .map((id) => fromCell?.ships.find((s) => s.id === id))
    .filter((s): s is ShipUnit => !!s)
  const preview = buildCombatPreview(game, combatCoord, playerId, incomingShips, {
    attackerMovementPlans: moves,
  })
  if (!preview) return ['Не удалось подготовить бой']
  const siegeAvailable = canBesiegeCell(game, playerId, combatCoord)
  const assaultBlocked = isBattleUnresolvable(preview)
  // Штурм невозможен, а осадить нельзя — вход на клетку не состоится.
  if (assaultBlocked && !siegeAvailable) return [UNRESOLVABLE_BATTLE_MSG]

  game.pendingCombat = {
    cellKey: hexKey(combatCoord.q, combatCoord.r),
    attackerId: playerId,
    defenderIds: defenderIdsOnCell(game, combatCoord, playerId),
    roundNumber: 1,
    phase: 'prep',
    trigger: 'movement',
    shipsDestroyedInCombat: false,
    prep: {
      phase: 'prep',
      defenderId: preview.defenderId,
      readyBy: {},
      combatOptions: {},
      movementFrom: from,
      movementPlans: moves.map((m) => ({ ...m, to: { ...m.to } })),
      incomingAttackerShipIds: [...incomingShipIds],
      ...(siegeAvailable ? { siegeAvailable: true } : {}),
      ...(assaultBlocked ? { assaultBlocked: true } : {}),
    },
  }
  pushCombatEvent(game, `Подготовка к бою на (${combatCoord.q},${combatCoord.r})`)
  return []
}

/**
 * Подготовка боя на общей клетке: вылазка осаждённого, штурм осаждающим или ответ осаждённого
 * на только что установленную осаду.
 */
export function setupCombatPrepForAssault(
  game: GameSnapshot,
  playerId: string,
  coord: HexCoord,
  options: { siegeResponse?: boolean } = {},
): string[] {
  const attackers = attackerShipsAt(game, coord, playerId)
  if (!attackers.length) return ['На клетке нет ваших кораблей']
  const preview = buildCombatPreview(game, coord, playerId, attackers)
  if (!preview) return ['На клетке нет противника']
  if (isBattleUnresolvable(preview)) return [UNRESOLVABLE_BATTLE_MSG]

  game.pendingCombat = {
    cellKey: hexKey(coord.q, coord.r),
    attackerId: playerId,
    defenderIds: [preview.defenderId],
    roundNumber: 1,
    phase: 'prep',
    trigger: 'stack',
    shipsDestroyedInCombat: false,
    prep: {
      phase: 'prep',
      defenderId: preview.defenderId,
      readyBy: {},
      combatOptions: {},
      assaultFrom: { ...coord },
      ...(options.siegeResponse ? { siegeResponse: true } : {}),
    },
  }
  pushCombatEvent(
    game,
    options.siegeResponse
      ? `Осаждённый решает, нападать ли на осаждающих на (${coord.q},${coord.r})`
      : `Подготовка к бою на общей клетке (${coord.q},${coord.r})`,
  )
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
  const fromCell = cellAt(game, from)
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
    phase: 'prep',
    trigger: 'bombardment',
    shipsDestroyedInCombat: false,
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
  pushCombatEvent(game, `Подготовка к обстрелу на (${target.q},${target.r})`)
  return []
}

function mergeSideTargetPriority(
  side: CombatRole,
  combatOptions: CombatOptions,
  targetPriority?: string[],
): void {
  if (!targetPriority) return
  combatOptions[side] = {
    ...combatOptions[side],
    targetPriority: [...targetPriority],
  }
}

export function updateCombatPrep(
  game: GameSnapshot,
  playerId: string,
  ready: boolean,
  targetPriority?: string[],
  supportSide?: CombatRole | null,
  diceTargets?: unknown,
): { errors: string[] } {
  const pending = game.pendingCombat
  const prep = combatPrepOf(pending)
  if (!pending || !prep) return { errors: ['Нет подготовки к бою'] }

  const isBombardment = pending.trigger === 'bombardment'
  const isAttacker = pending.attackerId === playerId
  const isDefender = prep.defenderId === playerId
  const preview = buildCombatPreviewFromPending(game)
  const supportCandidate = preview?.supportCandidates?.find(
    (candidate) => candidate.playerId === playerId,
  )
  if (!isAttacker && !isDefender && !supportCandidate) {
    return { errors: ['Вы не можете поддержать этот бой'] }
  }

  if ((isAttacker || isDefender) && isEliminatedPlayer(game, playerId)) {
    return { errors: ['Выбывший игрок не участвует в подготовке к бою'] }
  }

  if (!isAttacker && !isDefender) {
    if (isEliminatedPlayer(game, playerId)) {
      return { errors: ['Выбывший игрок не может поддерживать'] }
    }
    if (supportSide === undefined && ready && prep.readyBy[playerId] !== true) {
      return { errors: ['Сначала выберите сторону поддержки или «не поддерживать»'] }
    }
    if (supportSide !== undefined) {
      if (supportSide == null) {
        if (prep.combatOptions.supportSides) {
          const next = { ...prep.combatOptions.supportSides }
          delete next[playerId]
          prep.combatOptions.supportSides = next
        }
      } else {
        if (!canSupportCombatSide(game, supportSide, pending.attackerId, pending.defenderIds)) {
          return { errors: ['Нельзя поддерживать выбывшую сторону'] }
        }
        prep.combatOptions.supportSides = {
          ...prep.combatOptions.supportSides,
          [playerId]: supportSide,
        }
      }
    }
    if (!ready && prep.phase === 'countdown') {
      prep.phase = 'prep'
      prep.countdownStartedAt = undefined
      prep.readyBy = { ...prep.readyBy, [playerId]: false }
      return { errors: [] }
    }
    if (prep.phase === 'countdown') {
      return { errors: ['Обратный отсчёт уже идёт — отмените готовность, чтобы изменить поддержку'] }
    }
    if (diceTargets != null && prep.combatOptions.supportSides?.[playerId]) {
      const withSide = buildCombatPreviewFromPending(game)
      const errors = withSide
        ? mergePlayerDiceTargets(prep, withSide, playerId, diceTargets, {})
        : ['Не удалось проверить цели']
      if (errors.length) return { errors }
    }
    prep.readyBy[playerId] = ready
    if (!ready) delete prep.readyBy[playerId]
    const attackerReady = isCombatPrepSideReady(game, pending.attackerId, prep.readyBy)
    const defenderReady = isCombatPrepSideReady(game, prep.defenderId, prep.readyBy)
    const supportReady = (preview?.supportCandidates ?? []).every((candidate) =>
      isCombatPrepSideReady(game, candidate.playerId, prep.readyBy),
    )
    const prepComplete = isBombardment
      ? attackerReady
      : attackerReady && defenderReady && supportReady
    if (prepComplete) {
      prep.phase = 'countdown'
      prep.countdownStartedAt = Date.now()
    }
    return { errors: [] }
  }

  if (isBombardment && isDefender) {
    return { errors: ['Защитник не участвует в подготовке обстрела — ожидайте решения атакующего'] }
  }

  const side: CombatRole = isAttacker ? 'attacker' : 'defender'
  const prevSideOptions = prep.combatOptions[side]
  const restore = () => {
    prep.combatOptions[side] = prevSideOptions
  }

  if (prep.phase === 'countdown' && ready && (targetPriority || diceTargets != null)) {
    return { errors: ['Обратный отсчёт уже идёт — отмените готовность, чтобы изменить цели'] }
  }

  mergeSideTargetPriority(side, prep.combatOptions, targetPriority)
  if (diceTargets != null) {
    const errors = preview
      ? mergePlayerDiceTargets(prep, preview, playerId, diceTargets, {})
      : ['Не удалось проверить цели']
    if (errors.length) {
      restore()
      return { errors }
    }
  }

  if (targetPriority) {
    const priorityErrors = validatePendingCombatPrepOptions(game)
    if (priorityErrors.length) {
      restore()
      return { errors: priorityErrors }
    }
  }

  if (!ready && prep.phase === 'countdown') {
    prep.phase = 'prep'
    prep.countdownStartedAt = undefined
    prep.readyBy = { [playerId]: false }
    return { errors: [] }
  }
  if (prep.phase === 'countdown') {
    return { errors: [] }
  }

  if (ready && isAttacker && prep.assaultBlocked) {
    restore()
    return { errors: [UNRESOLVABLE_BATTLE_MSG] }
  }

  if (ready) {
    const readyErrors = validatePendingCombatPrepOptions(game)
    if (readyErrors.length) {
      restore()
      return { errors: readyErrors }
    }
  }

  prep.readyBy[playerId] = ready
  const attackerReady = isCombatPrepSideReady(game, pending.attackerId, prep.readyBy)
  const defenderReady = isCombatPrepSideReady(game, prep.defenderId, prep.readyBy)
  const supportReady = (preview?.supportCandidates ?? []).every((candidate) =>
    isCombatPrepSideReady(game, candidate.playerId, prep.readyBy),
  )
  const prepComplete = isBombardment
    ? attackerReady
    : attackerReady && defenderReady && supportReady
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
  if (pending?.phase !== 'prep') return { errors: ['Нет подготовки к бою'] }
  if (pending.attackerId !== playerId) return { errors: ['Отменить подготовку может только атакующий'] }
  const declinedResponse = pending.prep.siegeResponse === true
  game.pendingCombat = undefined
  pushCombatEvent(
    game,
    declinedResponse ? 'Осаждённый не стал нападать на осаждающих' : 'Подготовка к бою отменена атакующим',
  )
  return { errors: [] }
}

export function tickCombatPrepCountdown(game: GameSnapshot, now = Date.now()): boolean {
  const prep = combatPrepOf(game.pendingCombat)
  if (!prep || prep.phase !== 'countdown' || prep.countdownStartedAt == null) return false
  return now - prep.countdownStartedAt >= COMBAT_PREP_COUNTDOWN_MS
}
