/**
 * Метрики баланса. Замер снимается один раз за игровой ход, в конце фазы действий,
 * когда захваты уже применены.
 *
 * Главная величина — «точка невозврата»: последний ход, на котором будущий победитель
 * ещё не был единоличным лидером по центрам власти. Чем она позже относительно длины
 * партии, тем дольше партия остаётся неопределённой.
 */

import type { BehaviorCounters } from './behavior.js'

export interface PlayerSample {
  powerCenters: number
  cells: number
  ships: number
  faceUpValue: number
  claimLimit: number
  claimsMade: number
  /** Наибольший связный регион: открывает классы кораблей. */
  largestRegion: number
  /** Регионы, где можно строить (от трёх клеток). */
  productionRegions: number
  /** Бюджет перезарядки на этот ход: 0 — фишки не поднимаются. */
  rechargeBudget: number
  /** Фишки лицом вниз — ждут перезарядки. */
  faceDownTokens: number
  /** Своих клеток с фишками ресурсов. */
  tokenCells: number
  /** Номинал фишек лицом вверх в регионах меньше трёх клеток: там строить нельзя. */
  strandedValue?: number
}

export interface TurnSample {
  turn: number
  byPlayer: Record<string, PlayerSample>
}

/** Один бой: кто начал, чем кончился, сколько стоили потери. */
export interface BattleRecord {
  trigger: 'movement' | 'stack' | 'bombardment'
  /** attacker — защитники выбиты; defender — выбит атакующий; retreat — кто-то ушёл; none — без исхода. */
  outcome: 'attacker' | 'defender' | 'retreat' | 'mutual' | 'none'
  attackerLosses: number
  defenderLosses: number
  /** Цена потерь по стоимости постройки. */
  attackerLossValue: number
  defenderLossValue: number
}

export interface GameRecord {
  seed: number
  mapId: string
  playerIds: string[]
  winnerId: string | null
  reason: string | null
  turns: number
  hitTurnCap: boolean
  /** Средняя позиция игрока в очереди хода за партию: 0 — ходил первым. */
  meanOrderPosition: Record<string, number>
  samples: TurnSample[]
  tokenFaceValueSpent: number
  shipCostPaid: number
  firstUnlockTurn: Record<string, number>
  eliminationTurns: { playerId: string; turn: number }[]
  battles: BattleRecord[]
  /** Траты каждого места: номинал фишек, постройки маркером, построенные корабли. */
  spendByPlayer?: Record<string, { tokenFaceValue: number; builds: number; shipsBuilt: number }>
  /** Осады: установлено, взято (центр перешёл осаждающему), снято без взятия. */
  sieges: { established: number; captured: number; lifted: number }
  /** Выбранные доктрины по окнам: первый ход окна → доктрина → сколько раз. */
  doctrines: Record<string, Record<string, number>>
  /** Кому выдали стартовую фору, если замер идёт с форой. */
  handicappedPlayerId?: string
  /** Игрок с особой доктриной в замере силы доктрины: остальные играют как обычно. */
  deviantPlayerId?: string
  /** Уровень бота на каждом месте. */
  seatDifficulty?: Record<string, string>
  /**
   * Эпизоды «почти победы»: в начале фазы действий у игрока на один центр меньше порога.
   * `stopped` — он не победил в ближайшие два хода.
   */
  nearWins?: NearWinEpisode[]
  /**
   * Победа по порогу: сколько центров было у победителя в начале последней фазы действий. На один
   * меньше порога — дожал с порога; меньше — рывок в один ход.
   */
  winnerCentersBefore?: number
  /** Порог победы в этой партии. */
  threshold?: number
  /** Поведение каждого места: набеги, штурмы, отбитые центры, открытые центры (`behavior.ts`). */
  behavior?: Record<string, BehaviorCounters>
  /** Сбои оценки среднего и высокого уровня (заменены решением простого бота). */
  botErrors?: number
  /** Планы бота, которые движок отклонил: оценка разошлась с правилами. */
  botPlanRejects?: number
  botIssueSamples?: string[]
  error?: string
}

export interface NearWinEpisode {
  playerId: string
  turn: number
  /** Уровень бота, подошедшего к порогу. */
  level: string
  /** Сколько других мест в партии занимал высокий уровень — те, кто может помешать нарочно. */
  otherHardSeats: number
  stopped: boolean
  /**
   * «Остановлен» лишь потому, что в эти два хода партию выиграл кто-то другой. Такой эпизод
   * не говорит, что почти победителю помешали: соперник просто успел раньше.
   */
  otherWon?: boolean
}

/** Сводка эпизодов «почти победы»: сколько их было и сколько раз почти победителя остановили. */
export interface NearWinSummary {
  episodes: number
  stopped: number
  share: number
  /** Из остановленных — партию в эти два хода выиграл другой. */
  otherWon: number
}

/**
 * Экономика уровня: средние по местам этого уровня. «По ходу» — среднее по всем ходам партии,
 * «на ходу N» — снимок в конце хода N (партии короче N не входят).
 */
export interface EconomySummary {
  seats: number
  /** Своих клеток в среднем по ходу и на 5-м ходу. */
  meanCells: number
  cellsAtTurn5: number | null
  /** В конце партии. */
  cellsAtEnd: number
  largestRegionAtEnd: number
  productionRegionsAtEnd: number
  tokenCellsAtEnd: number
  /** Центров власти в среднем по ходу и на 3-м и 5-м ходу: видно, насколько бот торопится. */
  meanPowerCenters: number
  powerCentersAtTurn3: number | null
  powerCentersAtTurn5: number | null
  /** За партию: постройки маркером, корабли, потраченный номинал фишек. */
  buildsPerGame: number
  shipsBuiltPerGame: number
  tokensSpentPerGame: number
  /** Номинал фишек на ход партии. */
  tokensSpentPerTurn: number
  /** Доля ходов с нулевым бюджетом перезарядки и доля «голодных» (ноль при фишках лицом вниз). */
  budgetZeroShare: number
  starvedShare: number
  /** Номинал фишек лицом вверх в конце хода: недотраченные деньги. */
  meanFaceUpValue: number
  /** Из них — в регионах, где строить нельзя. */
  meanStrandedValue: number
  shipsAtEnd: number
}

function sampleAt(record: GameRecord, turn: number): TurnSample | undefined {
  return record.samples.find((sample) => sample.turn === turn)
}

function summarizeEconomy(records: readonly GameRecord[]): Record<string, EconomySummary> {
  const buckets: Record<string, Record<string, number[]>> = {}
  const push = (level: string, key: string, value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return
    const bucket = (buckets[level] ??= {})
    ;(bucket[key] ??= []).push(value)
  }
  for (const record of records) {
    const samples = record.samples.filter((sample) => Object.keys(sample.byPlayer).length > 0)
    if (samples.length === 0) continue
    const last = samples.at(-1)!
    for (const playerId of record.playerIds) {
      const level = record.seatDifficulty?.[playerId] ?? 'easy'
      const series = samples.map((sample) => sample.byPlayer[playerId]).filter((item): item is PlayerSample => !!item)
      if (series.length === 0) continue
      push(level, 'seats', 1)
      push(level, 'meanCells', mean(series.map((item) => item.cells)))
      push(level, 'cellsAtTurn5', sampleAt(record, 5)?.byPlayer[playerId]?.cells)
      const end = last.byPlayer[playerId]
      push(level, 'cellsAtEnd', end?.cells)
      push(level, 'largestRegionAtEnd', end?.largestRegion)
      push(level, 'productionRegionsAtEnd', end?.productionRegions)
      push(level, 'tokenCellsAtEnd', end?.tokenCells)
      push(level, 'shipsAtEnd', end?.ships)
      push(level, 'meanPowerCenters', mean(series.map((item) => item.powerCenters)))
      push(level, 'powerCentersAtTurn3', sampleAt(record, 3)?.byPlayer[playerId]?.powerCenters)
      push(level, 'powerCentersAtTurn5', sampleAt(record, 5)?.byPlayer[playerId]?.powerCenters)
      const spend = record.spendByPlayer?.[playerId]
      push(level, 'buildsPerGame', spend?.builds)
      push(level, 'shipsBuiltPerGame', spend?.shipsBuilt)
      push(level, 'tokensSpentPerGame', spend?.tokenFaceValue)
      if (spend) push(level, 'tokensSpentPerTurn', spend.tokenFaceValue / Math.max(1, record.turns))
      push(level, 'budgetZeroShare', mean(series.map((item) => (item.rechargeBudget <= 0 ? 1 : 0))))
      push(level, 'starvedShare', mean(series.map((item) => (item.rechargeBudget <= 0 && item.faceDownTokens > 0 ? 1 : 0))))
      push(level, 'meanFaceUpValue', mean(series.map((item) => item.faceUpValue)))
      push(level, 'meanStrandedValue', mean(series.map((item) => item.strandedValue ?? 0)))
    }
  }
  const out: Record<string, EconomySummary> = {}
  for (const [level, bucket] of Object.entries(buckets)) {
    const avg = (key: string): number => mean(bucket[key] ?? [])
    const avgOrNull = (key: string): number | null => (bucket[key]?.length ? mean(bucket[key]!) : null)
    out[level] = {
      seats: (bucket.seats ?? []).length,
      meanCells: avg('meanCells'),
      cellsAtTurn5: avgOrNull('cellsAtTurn5'),
      cellsAtEnd: avg('cellsAtEnd'),
      largestRegionAtEnd: avg('largestRegionAtEnd'),
      productionRegionsAtEnd: avg('productionRegionsAtEnd'),
      tokenCellsAtEnd: avg('tokenCellsAtEnd'),
      meanPowerCenters: avg('meanPowerCenters'),
      powerCentersAtTurn3: avgOrNull('powerCentersAtTurn3'),
      powerCentersAtTurn5: avgOrNull('powerCentersAtTurn5'),
      buildsPerGame: avg('buildsPerGame'),
      shipsBuiltPerGame: avg('shipsBuiltPerGame'),
      tokensSpentPerGame: avg('tokensSpentPerGame'),
      tokensSpentPerTurn: avg('tokensSpentPerTurn'),
      budgetZeroShare: avg('budgetZeroShare'),
      starvedShare: avg('starvedShare'),
      meanFaceUpValue: avg('meanFaceUpValue'),
      meanStrandedValue: avg('meanStrandedValue'),
      shipsAtEnd: avg('shipsAtEnd'),
    }
  }
  return out
}

/** Итог уровня сложности в замере: сколько мест он занимал и сколько партий выиграл. */
export interface DifficultyResult {
  /** Мест этого уровня за все партии. */
  seats: number
  /** Партий с победителем, в которых уровень участвовал. */
  decided: number
  wins: number
  /** Доля побед среди партий с победителем. */
  winRate: number
  /** Справедливая доля: сколько побед пришлось бы на эти места при равной силе. */
  fairShare: number
  /** Побед на одно место: сравнимо между уровнями при любой раскладке мест. */
  winsPerSeat: number
  /** Побед на место к справедливой доле `1 / число игроков`: больше единицы — сильнее среднего. */
  perSeatVsFair: number
}

function leaderOf(sample: TurnSample): string | null {
  let bestId: string | null = null
  let best = -1
  let tied = false
  for (const [playerId, player] of Object.entries(sample.byPlayer)) {
    if (player.powerCenters > best) {
      best = player.powerCenters
      bestId = playerId
      tied = false
    } else if (player.powerCenters === best) {
      tied = true
    }
  }
  return tied || best <= 0 ? null : bestId
}

/** Сколько раз за партию сменился единоличный лидер. Ничья лидером не считается. */
export function countLeadChanges(record: GameRecord): number {
  let changes = 0
  let previous: string | null = null
  for (const sample of record.samples) {
    const leader = leaderOf(sample)
    if (leader !== previous) {
      if (leader !== null) changes += 1
      previous = leader
    }
  }
  return changes
}

/**
 * Последний ход, на котором победитель не был единоличным лидером, плюс один.
 * null — победителя нет; 1 — лидировал с самого начала.
 */
export function pointOfNoReturn(record: GameRecord): number | null {
  if (!record.winnerId) return null
  let last = 0
  for (const sample of record.samples) {
    if (leaderOf(sample) !== record.winnerId) last = sample.turn
  }
  return last === 0 ? 1 : last + 1
}

/** Коэффициент Джини: 0 — все равны, 1 — всё у одного. */
export function gini(values: readonly number[]): number {
  const list = values.filter((value) => Number.isFinite(value) && value >= 0)
  if (list.length === 0) return 0
  const total = list.reduce((sum, value) => sum + value, 0)
  if (total === 0) return 0
  const sorted = [...list].sort((a, b) => a - b)
  let weighted = 0
  for (let i = 0; i < sorted.length; i += 1) weighted += (i + 1) * sorted[i]!
  return (2 * weighted) / (sorted.length * total) - (sorted.length + 1) / sorted.length
}

export function giniAtTurn(record: GameRecord, turn: number): number | null {
  const sample = record.samples.find((item) => item.turn === turn)
  if (!sample) return null
  return gini(Object.values(sample.byPlayer).map((player) => player.cells))
}

/**
 * Доля выбранного лимита захвата среди игроков с достаточным числом центров власти.
 * Отвечает на вопрос «не бумажная ли награда в размене»: если лимит систематически
 * не выбирается, связывают не центры власти, а маркеры действия.
 */
export function claimUtilisation(record: GameRecord, minPowerCenters: number): number | null {
  let limit = 0
  let made = 0
  for (const sample of record.samples) {
    for (const player of Object.values(sample.byPlayer)) {
      if (player.powerCenters < minPowerCenters) continue
      limit += player.claimLimit
      made += player.claimsMade
    }
  }
  return limit === 0 ? null : made / limit
}

/**
 * Усиление форы: во сколько раз преимущество по территории на позднем ходу больше,
 * чем на раннем. Больше 1 — игра разгоняет отрыв, меньше 1 — гасит.
 *
 * Это и есть прямой ответ на исходную жалобу: зеркальный прогон её проверить не может,
 * потому что оба бота играют одинаково и расходятся только из-за костей.
 */
export function advantageAmplification(
  record: GameRecord,
  earlyTurn: number,
  lateTurn: number,
): number | null {
  const who = record.handicappedPlayerId
  if (!who) return null
  const ratioAt = (turn: number): number | null => {
    const sample = record.samples.find((item) => item.turn === turn)
    if (!sample) return null
    const mine = sample.byPlayer[who]?.cells ?? 0
    const others = Object.entries(sample.byPlayer)
      .filter(([playerId]) => playerId !== who)
      .map(([, player]) => player.cells)
    const rival = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0
    if (rival <= 0) return null
    return mine / rival
  }
  const early = ratioAt(earlyTurn)
  const late = ratioAt(lateTurn)
  if (early == null || late == null || early <= 0) return null
  return late / early
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))
  return sorted[index]!
}

export interface Summary {
  games: number
  errors: number
  turns: { mean: number; p10: number; median: number; p90: number }
  hitTurnCapShare: number
  winRateBySeat: Record<string, number>
  /** Доля побед игрока с особой доктриной; справедливая доля — 1 / число игроков. */
  deviantWinRate: number | null
  winRateByOrderPosition: Record<string, number>
  meanLeadChanges: number
  pointOfNoReturn: { mean: number; meanShareOfGame: number | null }
  giniByTurn: Record<string, number>
  wasteRatio: number | null
  firstUnlockTurn: Record<string, number>
  claimUtilisationAt3Plus: number | null
  meanEliminationTurn: number | null
  victoryReasons: Record<string, number>
  /**
   * Победы по порогу по уровню победителя: сколько из них с порога (на один центр меньше в начале
   * последней фазы действий) и сколько рывком (на два и больше).
   */
  winPaths: Record<string, { wins: number; fromBrink: number; surge: number }>
  battles: {
    perGame: number
    bombardmentsPerGame: number
    /** Исходы боёв перемещением: доли по видам исхода. */
    outcomes: Record<string, number>
    meanAttackerLossValue: number
    meanDefenderLossValue: number
  }
  sieges: { perGame: number; capturedShare: number | null }
  /** Доли доктрин в каждом окне. */
  doctrinesByWindow: Record<string, Record<string, number>>
  /** Замеры с форой: null, если фора не выдавалась. */
  handicap: {
    winRate: number | null
    amplification: number | null
  }
  /** Победы по уровням сложности ботов. */
  winRateByDifficulty: Record<string, DifficultyResult>
  /** Экономика по уровням сложности ботов. */
  economyByDifficulty: Record<string, EconomySummary>
  /** Поведение по уровням: набеги, штурмы, отбитые и открытые центры. */
  behaviorByDifficulty: Record<string, BehaviorSummary>
  /** Как часто почти победителя останавливали. */
  nearWins: ReturnType<typeof summarizeNearWins>
  bot: { errors: number; planRejects: number; samples: string[] }
}

function summarizeDifficulties(records: readonly GameRecord[]): Record<string, DifficultyResult> {
  const out: Record<string, DifficultyResult> = {}
  const decided = records.filter((record) => record.winnerId)
  // Справедливая доля одного места: в среднем 1 / число игроков.
  let fairPerSeat = 0
  for (const record of decided) {
    const seats = record.seatDifficulty ?? {}
    const total = record.playerIds.length || 1
    fairPerSeat += 1 / total
    for (const playerId of record.playerIds) {
      const level = seats[playerId] ?? 'easy'
      const entry = (out[level] ??= { seats: 0, decided: 0, wins: 0, winRate: 0, fairShare: 0, winsPerSeat: 0, perSeatVsFair: 0 })
      entry.seats += 1
      entry.fairShare += 1 / total
      if (record.winnerId === playerId) entry.wins += 1
    }
  }
  fairPerSeat = decided.length ? fairPerSeat / decided.length : 0
  for (const [level, entry] of Object.entries(out)) {
    entry.decided = decided.filter((record) => record.playerIds.some((id) => (record.seatDifficulty?.[id] ?? 'easy') === level)).length
    entry.winRate = decided.length ? entry.wins / decided.length : 0
    entry.fairShare = decided.length ? entry.fairShare / decided.length : 0
    entry.winsPerSeat = entry.seats ? entry.wins / entry.seats : 0
    entry.perSeatVsFair = fairPerSeat ? entry.winsPerSeat / fairPerSeat : 0
  }
  return out
}

function nearWinSummary(episodes: readonly NearWinEpisode[]): NearWinSummary {
  const stopped = episodes.filter((episode) => episode.stopped).length
  return {
    episodes: episodes.length,
    stopped,
    share: episodes.length ? stopped / episodes.length : 0,
    otherWon: episodes.filter((episode) => episode.stopped && episode.otherWon).length,
  }
}

/**
 * Эпизоды «почти победы» по уровню почти победителя и по тому, были ли в партии другие места
 * высокого уровня: высокий уровень должен останавливать почти победителей заметно чаще.
 */
function summarizeNearWins(records: readonly GameRecord[]): {
  all: NearWinSummary
  byLevel: Record<string, NearWinSummary>
  withOtherHard: NearWinSummary
  withoutOtherHard: NearWinSummary
} {
  const episodes = records.flatMap((record) => record.nearWins ?? [])
  const byLevel: Record<string, NearWinSummary> = {}
  for (const level of [...new Set(episodes.map((episode) => episode.level))]) {
    byLevel[level] = nearWinSummary(episodes.filter((episode) => episode.level === level))
  }
  return {
    all: nearWinSummary(episodes),
    byLevel,
    withOtherHard: nearWinSummary(episodes.filter((episode) => episode.otherHardSeats > 0)),
    withoutOtherHard: nearWinSummary(episodes.filter((episode) => episode.otherHardSeats === 0)),
  }
}

/** Поведение уровня: средние на место за партию, открытые центры — на ход. */
export interface BehaviorSummary {
  seats: number
  raids: number
  storms: number
  besiegedStorms: number
  siegeCaptures: number
  neutralClaims: number
  lostToRaids: number
  lostToStorms: number
  /** Взятые набегом или штурмом и удержанные до начала следующего хода. */
  takesHeld: number
  retaken: number
  lossesHeld: number
  nearWinnerTakes: number
  /** Своих центров без кораблей под ударом врага с маркером — в среднем за ход. */
  exposedPerTurn: number
  /** Ходов «на пороге» (на один центр меньше порога) на место за партию. */
  brinkTurns: number
  /** За ход на пороге: центров взято и удержано, центров потеряно. */
  brinkTakesPerTurn: number
  brinkLossesPerTurn: number
}

/** Подписи счётчиков поведения для отчётов: поле, подпись, знаков после запятой. */
export const BEHAVIOR_LABELS: readonly (readonly [Exclude<keyof BehaviorSummary, 'seats'>, string, number])[] = [
  ['raids', 'набегов', 2],
  ['storms', 'штурмов', 2],
  ['besiegedStorms', 'из них осаждённых', 2],
  ['siegeCaptures', 'взято осадой', 2],
  ['neutralClaims', 'нейтральных занято', 2],
  ['lostToRaids', 'потеряно набегом', 2],
  ['lostToStorms', 'потеряно штурмом', 2],
  ['takesHeld', 'взятых удержано к началу хода', 2],
  ['retaken', 'отбито до начала хода', 2],
  ['lossesHeld', 'потерь к началу хода', 2],
  ['nearWinnerTakes', 'отнято у почти победителя', 2],
  ['exposedPerTurn', 'открытых центров за ход', 2],
  ['brinkTurns', 'ходов на пороге', 2],
  ['brinkTakesPerTurn', 'на пороге: взято за ход', 2],
  ['brinkLossesPerTurn', 'на пороге: потеряно за ход', 2],
]

function summarizeBehavior(records: readonly GameRecord[]): Record<string, BehaviorSummary> {
  const sums: Record<string, BehaviorCounters & { seats: number }> = {}
  for (const record of records) {
    for (const [playerId, counters] of Object.entries(record.behavior ?? {})) {
      const level = record.seatDifficulty?.[playerId] ?? 'easy'
      const sum = (sums[level] ??= {
        seats: 0, turns: 0, raids: 0, storms: 0, besiegedStorms: 0, siegeCaptures: 0, neutralClaims: 0,
        lostToRaids: 0, lostToStorms: 0, takesHeld: 0, retaken: 0, lossesHeld: 0, nearWinnerTakes: 0, exposedPcTurns: 0,
        brinkTurns: 0, brinkTakes: 0, brinkLosses: 0,
      })
      sum.seats += 1
      for (const key of Object.keys(counters) as (keyof BehaviorCounters)[]) sum[key] += counters[key]
    }
  }
  const out: Record<string, BehaviorSummary> = {}
  for (const [level, sum] of Object.entries(sums)) {
    const perSeat = (value: number) => (sum.seats ? value / sum.seats : 0)
    out[level] = {
      seats: sum.seats,
      raids: perSeat(sum.raids),
      storms: perSeat(sum.storms),
      besiegedStorms: perSeat(sum.besiegedStorms),
      siegeCaptures: perSeat(sum.siegeCaptures),
      neutralClaims: perSeat(sum.neutralClaims),
      lostToRaids: perSeat(sum.lostToRaids),
      lostToStorms: perSeat(sum.lostToStorms),
      takesHeld: perSeat(sum.takesHeld),
      retaken: perSeat(sum.retaken),
      lossesHeld: perSeat(sum.lossesHeld),
      nearWinnerTakes: perSeat(sum.nearWinnerTakes),
      exposedPerTurn: sum.turns ? sum.exposedPcTurns / sum.turns : 0,
      brinkTurns: perSeat(sum.brinkTurns),
      brinkTakesPerTurn: sum.brinkTurns ? sum.brinkTakes / sum.brinkTurns : 0,
      brinkLossesPerTurn: sum.brinkTurns ? sum.brinkLosses / sum.brinkTurns : 0,
    }
  }
  return out
}

const TRACKED_SHIP_TYPES = ['destroyer', 'cruiser', 'carrier', 'battleship', 'hyper']

export function summarize(records: readonly GameRecord[]): Summary {
  const ok = records.filter((record) => !record.error)
  const turns = ok.map((record) => record.turns)

  const winsBySeat: Record<string, number> = {}
  const victoryReasons: Record<string, number> = {}
  for (const record of ok) {
    if (record.winnerId) winsBySeat[record.winnerId] = (winsBySeat[record.winnerId] ?? 0) + 1
    const reason = record.reason ?? 'none'
    victoryReasons[reason] = (victoryReasons[reason] ?? 0) + 1
  }

  // Винрейт по месту и по позиции в очереди считаем раздельно: на симметричных картах
  // они смешаны, и по одному только номеру места нельзя понять, дело в очереди или в геометрии.
  const winsByPosition: Record<string, number> = {}
  const gamesByPosition: Record<string, number> = {}
  for (const record of ok) {
    const ranked = [...record.playerIds].sort(
      (a, b) => (record.meanOrderPosition[a] ?? 0) - (record.meanOrderPosition[b] ?? 0),
    )
    ranked.forEach((playerId, index) => {
      const key = String(index)
      gamesByPosition[key] = (gamesByPosition[key] ?? 0) + 1
      if (record.winnerId === playerId) winsByPosition[key] = (winsByPosition[key] ?? 0) + 1
    })
  }

  const ponrValues: number[] = []
  const ponrShares: number[] = []
  for (const record of ok) {
    const value = pointOfNoReturn(record)
    if (value == null) continue
    ponrValues.push(value)
    if (record.turns > 0) ponrShares.push(value / record.turns)
  }

  const giniByTurn: Record<string, number> = {}
  for (const turn of [5, 10, 15]) {
    const values = ok
      .map((record) => giniAtTurn(record, turn))
      .filter((value): value is number => value != null)
    if (values.length) giniByTurn[String(turn)] = mean(values)
  }

  const spent = ok.reduce((sum, record) => sum + record.tokenFaceValueSpent, 0)
  const paid = ok.reduce((sum, record) => sum + record.shipCostPaid, 0)

  const firstUnlockTurn: Record<string, number> = {}
  for (const type of TRACKED_SHIP_TYPES) {
    const values = ok
      .map((record) => record.firstUnlockTurn[type])
      .filter((value): value is number => value != null)
    if (values.length) firstUnlockTurn[type] = mean(values)
  }

  const claimShares = ok
    .map((record) => claimUtilisation(record, 3))
    .filter((value): value is number => value != null)

  const eliminationTurns = ok.flatMap((record) => record.eliminationTurns.map((item) => item.turn))

  const decided = ok.filter((record) => record.winnerId).length || 1
  const winRateBySeat: Record<string, number> = {}
  for (const [playerId, wins] of Object.entries(winsBySeat)) {
    winRateBySeat[playerId] = wins / decided
  }
  const winRateByOrderPosition: Record<string, number> = {}
  for (const [key, games] of Object.entries(gamesByPosition)) {
    winRateByOrderPosition[key] = (winsByPosition[key] ?? 0) / games
  }

  const deviantGames = ok.filter((record) => record.deviantPlayerId && record.winnerId)
  const deviantWinRate = deviantGames.length
    ? deviantGames.filter((record) => record.winnerId === record.deviantPlayerId).length / deviantGames.length
    : null

  const handicapped = ok.filter((record) => record.handicappedPlayerId)
  const handicapWins = handicapped.filter(
    (record) => record.winnerId && record.winnerId === record.handicappedPlayerId,
  ).length
  const amplifications = handicapped
    .map((record) => advantageAmplification(record, 3, 10))
    .filter((value): value is number => value != null)

  const allBattles = ok.flatMap((record) => record.battles ?? [])
  const fights = allBattles.filter((battle) => battle.trigger !== 'bombardment')
  const outcomes: Record<string, number> = {}
  for (const battle of fights) outcomes[battle.outcome] = (outcomes[battle.outcome] ?? 0) + 1
  for (const key of Object.keys(outcomes)) outcomes[key] = outcomes[key]! / (fights.length || 1)

  return {
    games: records.length,
    errors: records.length - ok.length,
    turns: {
      mean: mean(turns),
      p10: quantile(turns, 0.1),
      median: quantile(turns, 0.5),
      p90: quantile(turns, 0.9),
    },
    hitTurnCapShare: ok.length ? ok.filter((record) => record.hitTurnCap).length / ok.length : 0,
    winRateBySeat,
    deviantWinRate,
    winRateByOrderPosition,
    meanLeadChanges: mean(ok.map(countLeadChanges)),
    pointOfNoReturn: {
      mean: mean(ponrValues),
      meanShareOfGame: ponrShares.length ? mean(ponrShares) : null,
    },
    giniByTurn,
    wasteRatio: paid > 0 ? spent / paid : null,
    firstUnlockTurn,
    claimUtilisationAt3Plus: claimShares.length ? mean(claimShares) : null,
    meanEliminationTurn: eliminationTurns.length ? mean(eliminationTurns) : null,
    victoryReasons,
    winPaths: (() => {
      const out: Record<string, { wins: number; fromBrink: number; surge: number }> = {}
      for (const record of ok) {
        if (record.winnerCentersBefore == null || !record.winnerId) continue
        const level = record.seatDifficulty?.[record.winnerId] ?? 'easy'
        const entry = (out[level] ??= { wins: 0, fromBrink: 0, surge: 0 })
        const threshold = record.threshold ?? 6
        entry.wins += 1
        if (record.winnerCentersBefore >= threshold - 1) entry.fromBrink += 1
        else entry.surge += 1
      }
      return out
    })(),
    battles: {
      perGame: ok.length ? fights.length / ok.length : 0,
      bombardmentsPerGame: ok.length ? (allBattles.length - fights.length) / ok.length : 0,
      outcomes,
      meanAttackerLossValue: mean(fights.map((battle) => battle.attackerLossValue)),
      meanDefenderLossValue: mean(fights.map((battle) => battle.defenderLossValue)),
    },
    doctrinesByWindow: (() => {
      const totals: Record<string, Record<string, number>> = {}
      for (const record of ok) {
        for (const [window, counts] of Object.entries(record.doctrines ?? {})) {
          totals[window] ??= {}
          for (const [id, n] of Object.entries(counts)) totals[window]![id] = (totals[window]![id] ?? 0) + n
        }
      }
      for (const counts of Object.values(totals)) {
        const sum = Object.values(counts).reduce((a, b) => a + b, 0) || 1
        for (const id of Object.keys(counts)) counts[id] = counts[id]! / sum
      }
      return totals
    })(),
    sieges: {
      perGame: ok.length ? ok.reduce((sum, record) => sum + (record.sieges?.established ?? 0), 0) / ok.length : 0,
      capturedShare: (() => {
        const ended = ok.reduce(
          (sum, record) => sum + (record.sieges?.captured ?? 0) + (record.sieges?.lifted ?? 0),
          0,
        )
        const captured = ok.reduce((sum, record) => sum + (record.sieges?.captured ?? 0), 0)
        return ended ? captured / ended : null
      })(),
    },
    handicap: {
      winRate: handicapped.length ? handicapWins / handicapped.length : null,
      amplification: amplifications.length ? mean(amplifications) : null,
    },
    winRateByDifficulty: summarizeDifficulties(ok),
    economyByDifficulty: summarizeEconomy(ok),
    behaviorByDifficulty: summarizeBehavior(ok),
    nearWins: summarizeNearWins(ok),
    bot: {
      errors: records.reduce((sum, record) => sum + (record.botErrors ?? 0), 0),
      planRejects: records.reduce((sum, record) => sum + (record.botPlanRejects ?? 0), 0),
      samples: [...new Set(records.flatMap((record) => record.botIssueSamples ?? []))].slice(0, 5),
    },
  }
}
