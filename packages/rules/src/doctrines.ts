import { trimGameEventLog } from './event-log.js'
import type { GameSnapshot } from './save-file.js'
import { besiegedCellKeysOf } from './siege.js'
import { getShipMoveRange } from './ships.js'
import type { HexCoord, ShipType } from './types.js'
import { hexKey } from './types.js'

/**
 * Доктрины (ADR 020) вместо колоды событий.
 *
 * Раз в окно ходов (по умолчанию 3: ходы 1–3, 4–6, …, 13–15) каждый игрок выбирает доктрину —
 * стратегическое лицо на несколько ходов. Выбор одновременный: пока не выбрали все, чужие
 * доктрины скрыты. Доктрина действует с начала хода, в котором выбрана, поэтому и бюджет
 * перезарядки этого хода, и захват в его конце считаются уже по ней.
 *
 * Доктрины затрагивают только то, что принадлежит игроку, — экономику, скорость, захват,
 * попадания его кораблей — и не меняют процедуру боя.
 */
export type DoctrineId = 'expansion' | 'production' | 'maneuvers' | 'attack' | 'defense' | 'none'

export interface DoctrineDefinition {
  id: DoctrineId
  name: string
  /** Что даёт — для игрока, одной строкой. */
  gives: string
  /** Чем платит — для игрока, одной строкой. */
  costs: string
  claimLimit: number
  rechargeBudget: number
  moveRange: number
  /** На какие классы действует `moveRange`; не задано — на все. */
  moveRangeTypes?: readonly ShipType[]
  /** Поправка к нужному на кубике значению для своих выстрелов: −1 — точнее. */
  ownShots: number
  /** Поправка к нужному значению для выстрелов противника по своим кораблям: +1 — труднее. */
  enemyShots: number
  /** `enemyShots` действует, только когда корабли игрока бьются на его собственной клетке. */
  enemyShotsOnOwnCellsOnly?: boolean
}

export const DOCTRINES: readonly DoctrineDefinition[] = [
  {
    id: 'expansion',
    name: 'Экспансия',
    gives: '+1 к лимиту захвата',
    costs: '−1 к бюджету перезарядки',
    claimLimit: 1,
    rechargeBudget: -1,
    moveRange: 0,
    ownShots: 0,
    enemyShots: 0,
  },
  {
    id: 'production',
    name: 'Производство',
    gives: '+2 к бюджету перезарядки',
    costs: 'ничего, кроме выбора другой доктрины',
    claimLimit: 0,
    rechargeBudget: 2,
    moveRange: 0,
    ownShots: 0,
    enemyShots: 0,
  },
  {
    id: 'maneuvers',
    name: 'Манёвры',
    gives: '+1 к скорости линкоров, авианосцев и гиперорудий',
    costs: '−1 к бюджету перезарядки и −1 к лимиту захвата',
    claimLimit: -1,
    rechargeBudget: -1,
    moveRange: 1,
    // Ускорение эсминцев решало гонку за центрами в первые ходы при любой цене (замер 2026-09-23).
    moveRangeTypes: ['battleship', 'carrier', 'hyper'],
    ownShots: 0,
    enemyShots: 0,
  },
  {
    id: 'attack',
    name: 'Атака',
    gives: 'ваши корабли попадают на 1 легче и стреляют на клетку дальше; не действует, пока осаждают ваши центры',
    costs: '−1 к бюджету перезарядки и −1 к лимиту захвата',
    claimLimit: -1,
    rechargeBudget: -1,
    moveRange: 0,
    ownShots: -1,
    enemyShots: 0,
  },
  {
    id: 'defense',
    name: 'Оборона',
    gives: 'на ваших клетках противнику нужно на 1 больше, чтобы попасть по вашим кораблям',
    costs: '−1 к лимиту захвата',
    claimLimit: -1,
    rechargeBudget: 0,
    moveRange: 0,
    ownShots: 0,
    enemyShots: 1,
    enemyShotsOnOwnCellsOnly: true,
  },
  {
    id: 'none',
    name: 'Без доктрины',
    gives: 'ничего',
    costs: 'ничего',
    claimLimit: 0,
    rechargeBudget: 0,
    moveRange: 0,
    ownShots: 0,
    enemyShots: 0,
  },
]

export const DEFAULT_DOCTRINE_WINDOW = 3

const BY_ID = new Map(DOCTRINES.map((doctrine) => [doctrine.id, doctrine]))

export function isDoctrineId(value: unknown): value is DoctrineId {
  return typeof value === 'string' && BY_ID.has(value as DoctrineId)
}

export function doctrineDefinition(id: DoctrineId): DoctrineDefinition {
  return BY_ID.get(id)!
}

export interface ActiveDoctrine {
  doctrineId: DoctrineId
  /** Ход, с которого доктрина действует. */
  fromTurn: number
}

/** Незакрытый выбор доктрин: окно и уже сделанные (скрытые до вскрытия) выборы. */
export interface DoctrineChoiceState {
  windowStart: number
  picks: Record<string, DoctrineId>
  /**
   * Кто уже выбрал. Заполняется в наблюдении для игрока: чужие выборы из `picks` там
   * вырезаны, а знать, кого ждём, нужно.
   */
  pickedBy?: string[]
}

export function doctrinesEnabled(game: GameSnapshot): boolean {
  return (game.doctrineWindow ?? 0) > 0
}

/** Первый ход окна, в которое попадает ход `turn`. */
export function doctrineWindowStart(game: GameSnapshot, turn = game.turnNumber): number {
  const size = game.doctrineWindow ?? 0
  if (size <= 0) return 1
  return Math.floor((turn - 1) / size) * size + 1
}

/** Доктрина игрока, действующая в текущем окне; вне окна выбора — «без доктрины». */
export function activeDoctrineId(game: GameSnapshot, playerId: string): DoctrineId {
  if (!doctrinesEnabled(game)) return 'none'
  const active = game.doctrineByPlayer?.[playerId]
  if (!active) return 'none'
  return doctrineWindowStart(game, active.fromTurn) === doctrineWindowStart(game) ? active.doctrineId : 'none'
}

function activeDefinition(game: GameSnapshot, playerId: string): DoctrineDefinition {
  return doctrineDefinition(activeDoctrineId(game, playerId))
}

export function doctrineClaimLimitModifier(game: GameSnapshot, playerId: string): number {
  return activeDefinition(game, playerId).claimLimit
}

export function doctrineRechargeModifier(game: GameSnapshot, playerId: string): number {
  return activeDefinition(game, playerId).rechargeBudget
}

export function doctrineMoveRangeModifier(
  game: GameSnapshot,
  playerId: string,
  type?: ShipType,
): number {
  const doctrine = activeDefinition(game, playerId)
  if (type && doctrine.moveRangeTypes && !doctrine.moveRangeTypes.includes(type)) return 0
  return doctrine.moveRange
}

/** Дальность хода корабля игрока с учётом доктрины; не меньше одной клетки. */
export function effectiveMoveRange(game: GameSnapshot, type: ShipType, playerId?: string): number {
  const base = getShipMoveRange(type)
  if (!playerId) return base
  return Math.max(1, base + doctrineMoveRangeModifier(game, playerId, type))
}

/**
 * Поправка к нужному на кубике значению для выстрела `shooterId` по кораблям `targetOwnerId`.
 * «Атака» не действует, пока осаждают клетки самого стреляющего: бонус — для штурма, а не для
 * обороны своего осаждённого центра.
 */
export function doctrineShotModifier(
  game: GameSnapshot,
  shooterId: string,
  targetOwnerId: string | null,
  battleCoord?: HexCoord,
): number {
  if (!doctrinesEnabled(game)) return 0
  let modifier = 0
  const own = activeDefinition(game, shooterId)
  if (own.ownShots !== 0 && besiegedCellKeysOf(game, shooterId).length === 0) modifier += own.ownShots
  if (targetOwnerId) {
    const target = activeDefinition(game, targetOwnerId)
    if (target.enemyShots !== 0 && (!target.enemyShotsOnOwnCellsOnly || !battleCoord
      || cellOwner(game, battleCoord) === targetOwnerId)) {
      modifier += target.enemyShots
    }
  }
  return modifier
}

function cellOwner(game: GameSnapshot, coord: HexCoord): string | null {
  const key = hexKey(coord.q, coord.r)
  return game.cells.find((cell) => hexKey(cell.coord.q, cell.coord.r) === key)?.controlOwnerId ?? null
}

function participants(game: GameSnapshot): string[] {
  const participating = game.participatingPlayerIds?.length
    ? new Set(game.participatingPlayerIds)
    : null
  return game.players
    .filter((player) => !player.eliminated && (!participating || participating.has(player.id)))
    .map((player) => player.id)
}

export function doctrineChoiceOwed(game: GameSnapshot, playerId: string): boolean {
  const choice = game.doctrineChoice
  if (!choice) return false
  if (!participants(game).includes(playerId)) return false
  return !(playerId in choice.picks) && !choice.pickedBy?.includes(playerId)
}

/**
 * Начало хода: если это первый ход окна, открыть выбор доктрин. Идемпотентно — повторный
 * вызов в том же ходу ничего не делает.
 */
export function openDoctrineWindowIfDue(game: GameSnapshot): void {
  if (!doctrinesEnabled(game)) return
  const start = doctrineWindowStart(game)
  if (start !== game.turnNumber) return
  if (game.doctrineChoice?.windowStart === start) return
  const anyActive = Object.values(game.doctrineByPlayer ?? {}).some(
    (doctrine) => doctrine.fromTurn === start,
  )
  if (anyActive) return
  game.doctrineChoice = { windowStart: start, picks: {} }
}

function appendDoctrineEvent(game: GameSnapshot, message: string): void {
  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'doctrine',
    message,
    timestamp: Date.now(),
  })
  trimGameEventLog(game)
}

/**
 * Вскрыть выбор, когда выбрали все. Возвращает игроков, чьи доктрины только что вступили в
 * силу, — вызывающий выдаёт им бюджет перезарядки.
 */
function revealIfComplete(game: GameSnapshot): string[] {
  const choice = game.doctrineChoice
  if (!choice) return []
  const players = participants(game)
  if (!players.every((id) => id in choice.picks)) return []
  game.doctrineByPlayer ??= {}
  for (const id of players) {
    game.doctrineByPlayer[id] = { doctrineId: choice.picks[id]!, fromTurn: game.turnNumber }
  }
  delete game.doctrineChoice
  const names = game.players
    .filter((player) => players.includes(player.id))
    .map((player) => `${player.name} — ${doctrineDefinition(game.doctrineByPlayer![player.id]!.doctrineId).name}`)
  appendDoctrineEvent(game, `Доктрины вскрыты: ${names.join(', ')}`)
  return players
}

export const DOCTRINE_ERRORS = {
  notNow: 'Сейчас доктрину не выбирают',
  already: 'Доктрина на это окно уже выбрана',
  unknown: 'Такой доктрины нет',
} as const

/** Выбрать доктрину. Возвращает ошибки и игроков, у которых доктрина вступила в силу. */
export function chooseDoctrine(
  game: GameSnapshot,
  playerId: string,
  doctrineId: unknown,
): { errors: string[]; revealed: string[] } {
  if (!isDoctrineId(doctrineId)) return { errors: [DOCTRINE_ERRORS.unknown], revealed: [] }
  const choice = game.doctrineChoice
  if (!choice || !participants(game).includes(playerId)) {
    return { errors: [DOCTRINE_ERRORS.notNow], revealed: [] }
  }
  if (playerId in choice.picks) return { errors: [DOCTRINE_ERRORS.already], revealed: [] }
  choice.picks[playerId] = doctrineId
  return { errors: [], revealed: revealIfComplete(game) }
}

/** Закрыть выбор за всех, кто не успел, — «без доктрины». Партия не должна вставать. */
export function autoResolveDoctrines(game: GameSnapshot): string[] {
  const choice = game.doctrineChoice
  if (!choice) return []
  for (const id of participants(game)) {
    if (!(id in choice.picks)) choice.picks[id] = 'none'
  }
  return revealIfComplete(game)
}

/**
 * Что видит игрок `viewerId` о незакрытом выборе: свой выбор и кто уже выбрал. Чужие выборы
 * скрыты до вскрытия — иначе последний выбирающий видел бы доктрины соперников.
 */
export function maskDoctrineChoice(
  choice: DoctrineChoiceState | undefined,
  viewerId: string | null,
): DoctrineChoiceState | null {
  if (!choice) return null
  const own = viewerId && viewerId in choice.picks ? { [viewerId]: choice.picks[viewerId]! } : {}
  return { windowStart: choice.windowStart, picks: own, pickedBy: Object.keys(choice.picks) }
}
