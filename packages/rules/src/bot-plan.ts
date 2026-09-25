/**
 * План высокого уровня: какой центр власти бот сейчас берёт и почему.
 *
 * Без плана бот каждый шаг заново выбирает лучшую цель, и при почти равных целях корабли мечутся
 * между ними, а угроза набега то уводит корабль домой, то отпускает. План — это одна цель
 * (нейтральный центр, чужой пустой центр, чужой центр под гарнизоном или центр того, кто вот-вот
 * победит), которую бот держит из хода в ход: её ценность для него выше на `commitment`, поэтому
 * корабли идут к ней, а оборона перебивает её, только когда явно выгоднее (`raidRisk` в
 * `bot-strategy.ts`).
 *
 * План бросается, когда он потерял смысл: цель взята или занята своим кораблём, обесценилась,
 * стала недостижимой, шансы на её взятие рухнули, к ней нет продвижения три хода. Раз в ход (в
 * первом решении хода) план ещё сравнивается с другими целями и уступает цели, которая выгоднее
 * в `SWITCH_MARGIN` раз. Всё это — слова в журнале решений (`setBotTraceListener`).
 *
 * Память живёт вне снимка партии: сервер держит её рядом со счётчиком попыток маркеров
 * (`GreedyBotOptions.memory`), харнесс — на партию. Без памяти бот играет без плана, как раньше:
 * снимок и сохранения не меняются.
 */

import { distancesFrom } from './bot-board.js'
import { combatStrength } from './bot-combat-math.js'
import type { BotSituation } from './bot-strategy.js'
import { effectiveMoveRange } from './doctrines.js'
import type { ShipType } from './types.js'

export type BotPlanKind = 'expand' | 'raid' | 'assault' | 'deny'

export interface BotPlan {
  /** Клетка цели — центр власти. */
  target: string
  kind: BotPlanKind
  /** С какого хода бот держит этот план. */
  sinceTurn: number
  /** Ценность цели, когда план принят. */
  value: number
  /** Лучшее (наименьшее) число ходов до цели за время плана и ход, когда оно улучшилось. */
  bestEta: number
  progressTurn: number
  /**
   * Ход, в который план последний раз сравнивался с другими целями. Сравнение — раз в ход, в
   * первом решении хода: посреди хода ценности целей скачут от каждого перелёта, и бот метался бы.
   */
  comparedTurn: number
}

export interface BotMemory {
  plans: Map<string, BotPlan>
  /** Последняя смена плана словами — для журнала решений; журнал её забирает. */
  notes: Map<string, string>
  /** Цель, брошенная за отсутствие продвижения, не берётся снова в тот же ход. */
  dropped: Map<string, { target: string; turn: number }>
}

export function createBotMemory(): BotMemory {
  return { plans: new Map(), notes: new Map(), dropped: new Map() }
}

let activeMemory: BotMemory | null = null

/**
 * Выполнить `fn` с памятью ботов: всё, что бот решает внутри, видит и обновляет её планы.
 * Вложенные вызовы восстанавливают прежнюю память.
 */
export function withBotMemory<T>(memory: BotMemory | null | undefined, fn: () => T): T {
  const previous = activeMemory
  activeMemory = memory ?? null
  try {
    return fn()
  } finally {
    activeMemory = previous
  }
}

export function currentBotMemory(): BotMemory | null {
  return activeMemory
}

/** Сколько ходов до цели дальше хода, чтобы она ещё годилась в план. */
const MAX_PLAN_ETA = 4
/** Во сколько раз новая цель должна быть выгоднее текущей, чтобы бот сменил план. */
const SWITCH_MARGIN = 1.6
/** Ходов без продвижения к цели, после которых план брошен. */
const STALL_TURNS = 3
/** Цель дешевле этой доли центра власти планом не становится. */
const MIN_PLAN_VALUE = 50

interface PlanCandidate {
  key: string
  kind: BotPlanKind
  value: number
  eta: number
  score: number
}

function turnsToReach(situation: BotSituation, key: string): { eta: number; force: ShipType[] } {
  const dist = distancesFrom(situation.board, key)
  let eta = Infinity
  const byShip: { turns: number; type: ShipType }[] = []
  for (const ship of situation.me.ships) {
    const d = dist.get(ship.key)
    if (d == null) continue
    const turns = Math.ceil(d / Math.max(1, effectiveMoveRange(situation.board.game, ship.type, situation.playerId)))
    byShip.push({ turns, type: ship.type })
    eta = Math.min(eta, turns)
  }
  // Сила, которая соберётся у цели к ходу после ближайшего корабля.
  const force = byShip.filter((item) => item.turns <= Math.max(1, eta) + 1).map((item) => item.type)
  return { eta, force }
}

type Rejection = 'цель обесценилась' | 'цель недостижима' | 'шансы на взятие упали'

function evaluateTarget(
  situation: BotSituation,
  key: string,
  goalValue: (key: string) => number,
  isDenyTarget: (playerId: string | null | undefined) => boolean,
): PlanCandidate | Rejection {
  const cell = situation.board.cells.get(key)!
  const value = goalValue(key)
  if (value < MIN_PLAN_VALUE) return 'цель обесценилась'
  const { eta, force } = turnsToReach(situation, key)
  if (!Number.isFinite(eta) || eta > MAX_PLAN_ETA) return 'цель недостижима'
  const defenders = cell.ships.filter((ship) => ship.ownerId !== situation.playerId).map((ship) => ship.type)
  const defended = defenders.length > 0
  if (defended && combatStrength(force) < 0.6 * combatStrength(defenders)) return 'шансы на взятие упали'
  const owner = cell.controlOwnerId
  const kind: BotPlanKind = isDenyTarget(owner) || isDenyTarget(situation.capturesAhead.get(key))
    ? 'deny'
    : owner == null ? 'expand' : defended ? 'assault' : 'raid'
  return { key, kind, value, eta, score: value * 0.6 ** Math.max(0, eta - 1) }
}

function appendNote(memory: BotMemory, playerId: string, text: string): void {
  const before = memory.notes.get(playerId)
  memory.notes.set(playerId, before ? `${before}; ${text}` : text)
}

/** Забрать смены плана словами (для журнала решений). */
export function takePlanNotes(memory: BotMemory | null, playerId: string): string | null {
  const note = memory?.notes.get(playerId) ?? null
  if (note) memory!.notes.delete(playerId)
  return note
}

/** Лучшая цель; ничьи — случайно (по сиду прогона), как везде у бота: иначе зеркальные карты дают перекос. */
function bestCandidate(candidates: readonly PlanCandidate[]): PlanCandidate | null {
  let top: PlanCandidate[] = []
  for (const candidate of candidates) {
    if (!top.length || candidate.score > top[0]!.score) top = [candidate]
    else if (candidate.score === top[0]!.score) top.push(candidate)
  }
  if (top.length <= 1) return top[0] ?? null
  return top[Math.floor(Math.random() * top.length)]!
}

const KIND_WORDS: Record<BotPlanKind, string> = {
  expand: 'занять нейтральный центр',
  raid: 'войти в пустой чужой центр',
  assault: 'взять центр под гарнизоном',
  deny: 'отнять центр у почти победителя',
}

export function describePlan(plan: BotPlan): string {
  return `${KIND_WORDS[plan.kind]} ${plan.target} (с хода ${plan.sinceTurn})`
}

/**
 * Текущий план бота: держит прежний, пока он не потерял смысл, иначе берёт лучшую цель.
 * `goalValue` — ценность клетки без бонуса плана (иначе план сравнивался бы сам с собой).
 */
export function resolvePlan(
  situation: BotSituation,
  memory: BotMemory,
  goalValue: (key: string) => number,
  isDenyTarget: (playerId: string | null | undefined) => boolean,
): BotPlan | null {
  const { playerId, turn } = situation
  const candidates: PlanCandidate[] = []
  const rejected = new Map<string, Rejection>()
  for (const [key, cell] of situation.board.cells) {
    if (!cell.isPowerCenter || cell.controlOwnerId === playerId) continue
    // Свой корабль уже стоит на центре: он займётся в начале хода, план исполнен.
    if (situation.plannedClaims.keys.has(key)) continue
    const result = evaluateTarget(situation, key, goalValue, isDenyTarget)
    if (typeof result === 'string') rejected.set(key, result)
    else candidates.push(result)
  }
  const best = bestCandidate(candidates)

  let plan = memory.plans.get(playerId) ?? null
  if (plan) {
    const cell = situation.board.cells.get(plan.target)
    const current = candidates.find((candidate) => candidate.key === plan!.target)
    let drop: string | null = null
    if (!cell || cell.controlOwnerId === playerId) drop = 'цель взята'
    else if (situation.plannedClaims.keys.has(plan.target)) drop = 'цель занята своим кораблём'
    else if (!current) drop = rejected.get(plan.target) ?? 'цель обесценилась'
    else {
      if (current.eta < plan.bestEta) {
        plan.bestEta = current.eta
        plan.progressTurn = turn
      }
      if (turn - plan.progressTurn >= STALL_TURNS) {
        drop = 'нет продвижения к цели'
        memory.dropped.set(playerId, { target: plan.target, turn })
      } else if (plan.comparedTurn !== turn) {
        plan.comparedTurn = turn
        if (best && best.key !== plan.target && best.score > current.score * SWITCH_MARGIN) {
          drop = `нашлась цель заметно выгоднее (${best.key})`
        }
      }
    }
    if (drop) {
      appendNote(memory, playerId, `план брошен — ${drop}: ${describePlan(plan)}`)
      memory.plans.delete(playerId)
      plan = null
    }
  }

  if (!plan) {
    const blocked = memory.dropped.get(playerId)
    const pick = blocked?.turn === turn
      ? bestCandidate(candidates.filter((candidate) => candidate.key !== blocked.target))
      : best
    if (pick) {
      plan = {
        target: pick.key,
        kind: pick.kind,
        sinceTurn: turn,
        value: pick.value,
        bestEta: pick.eta,
        progressTurn: turn,
        comparedTurn: turn,
      }
      memory.plans.set(playerId, plan)
      appendNote(memory, playerId, `новый план: ${describePlan(plan)}`)
    }
  }
  return plan
}
