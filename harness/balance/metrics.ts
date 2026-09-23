/**
 * Метрики баланса. Замер снимается один раз за игровой ход, в конце фазы действий,
 * когда захваты уже применены.
 *
 * Главная величина — «точка невозврата»: последний ход, на котором будущий победитель
 * ещё не был единоличным лидером по центрам власти. Чем она позже относительно длины
 * партии, тем дольше партия остаётся неопределённой.
 */

export interface PlayerSample {
  powerCenters: number
  cells: number
  ships: number
  faceUpValue: number
  claimLimit: number
  claimsMade: number
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
  /** Осады: установлено, взято (центр перешёл осаждающему), снято без взятия. */
  sieges: { established: number; captured: number; lifted: number }
  /** Кому выдали стартовую фору, если замер идёт с форой. */
  handicappedPlayerId?: string
  error?: string
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
  winRateByOrderPosition: Record<string, number>
  meanLeadChanges: number
  pointOfNoReturn: { mean: number; meanShareOfGame: number | null }
  giniByTurn: Record<string, number>
  wasteRatio: number | null
  firstUnlockTurn: Record<string, number>
  claimUtilisationAt3Plus: number | null
  meanEliminationTurn: number | null
  victoryReasons: Record<string, number>
  battles: {
    perGame: number
    bombardmentsPerGame: number
    /** Исходы боёв перемещением: доли по видам исхода. */
    outcomes: Record<string, number>
    meanAttackerLossValue: number
    meanDefenderLossValue: number
  }
  sieges: { perGame: number; capturedShare: number | null }
  /** Замеры с форой: null, если фора не выдавалась. */
  handicap: {
    winRate: number | null
    amplification: number | null
  }
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
    battles: {
      perGame: ok.length ? fights.length / ok.length : 0,
      bombardmentsPerGame: ok.length ? (allBattles.length - fights.length) / ok.length : 0,
      outcomes,
      meanAttackerLossValue: mean(fights.map((battle) => battle.attackerLossValue)),
      meanDefenderLossValue: mean(fights.map((battle) => battle.defenderLossValue)),
    },
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
  }
}
