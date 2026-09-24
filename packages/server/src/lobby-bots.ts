/**
 * Боты в обычных комнатах: хозяин лобби сажает их на свободные места, дальше за них ходит
 * сервер. Решает тот же жадный бот, что и в замерах баланса (`planGreedyBotAction`), и его
 * действие применяется тем же путём, что и действие человека.
 *
 * Бот делает одно действие за шаг и выдерживает паузу, чтобы люди видели ход, а не
 * мгновенный итог. За людей бот не решает — в бою он ждёт их ответа.
 */

import {
  buildCombatPreviewFromPending,
  planGreedyBotAction,
  type MarkerAttempts,
  type PlannedBotAction,
} from '@galaxy/rules'
import { roomBotIds } from './bot-tick.js'
import { debugLog } from './debug-log.js'
import type { Room } from './room.js'

/** Имена ботов — по порядку мест в лобби. */
export const LOBBY_BOT_NAMES = ['Бот Альфа', 'Бот Бета', 'Бот Гамма', 'Бот Дельта', 'Бот Эпсилон']

/** Как часто сервер проверяет комнаты с ботами. */
export const LOBBY_BOT_TICK_MS = 200

/** Пауза после действия бота: расстановку маркеров показывать быстрее, чем бой и перелёт. */
const PAUSE_AFTER_MS: Record<string, number> = {
  'toggle-marker': 250,
  'choose-doctrine': 250,
  'execute-claim-picks': 400,
  'execute-recharge-picks': 400,
}
const DEFAULT_PAUSE_MS = 600

/** Бот ничего не может сделать, а партия стоит: пора аварийно сдвинуть её. */
const STALL_MS = 15_000

/** Отказы движка подряд, после которых бот ждёт перемен в партии, а не долбит одно и то же. */
const MAX_REJECTS = 3

interface LobbyBotRuntime {
  turn: number
  attempts: MarkerAttempts
  nextAt: number
  /** Ревизия партии, при которой бот последний раз смотрел на неё. */
  revision: number
  /** С какого момента партия стоит на этой ревизии. */
  since: number
  rejects: number
  /** Бот уже решил, что ему нечего делать на этой ревизии. */
  idle: boolean
  /** Аварийный шаг на этой ревизии уже пробовали. */
  rescued: boolean
}

const runtimes = new WeakMap<Room, LobbyBotRuntime>()

function runtimeOf(room: Room, now: number): LobbyBotRuntime {
  let runtime = runtimes.get(room)
  if (!runtime) {
    runtime = {
      turn: room.state.turnNumber,
      attempts: new Map(),
      nextAt: 0,
      revision: room.observationRevision,
      since: now,
      rejects: 0,
      idle: false,
      rescued: false,
    }
    runtimes.set(room, runtime)
  }
  return runtime
}

export function roomHasLobbyBots(room: Room): boolean {
  return room.mode !== 'tutorial' && roomBotIds(room).length > 0
}

export type ApplyBotAction = (
  room: Room,
  botId: string,
  actionId: string,
  params?: Record<string, unknown>,
) => void

export type LobbyBotStep = 'acted' | 'waiting' | 'idle'

/**
 * Партия стоит дольше `STALL_MS`, а боту нечего делать. Выручаем только там, где люди ни при
 * чём: бой, в котором все участники — боты, снимаем; ход бота без боя — передаём.
 */
function rescueAction(room: Room, bots: ReadonlySet<string>): PlannedBotAction | null {
  const game = room.state
  const pending = game.pendingCombat
  if (pending) {
    const involved = [
      pending.attackerId,
      ...pending.defenderIds,
      ...(buildCombatPreviewFromPending(game)?.supportCandidates ?? []).map((c) => c.playerId),
    ]
    if (!involved.every((id) => bots.has(id))) return null
    return { playerId: pending.attackerId, actionId: 'abort-combat' }
  }
  const active = game.activePlayerId
  if (!active || !bots.has(active) || game.siegeContinuationChoice) return null
  return { playerId: active, actionId: 'advance-phase' }
}

/**
 * Один шаг ботов комнаты: не больше одного действия. `acted` — бот сходил, `waiting` — пауза
 * после прошлого действия, `idle` — ботам делать нечего (ход или решение человека).
 */
export function stepLobbyBots(room: Room, apply: ApplyBotAction, now = Date.now()): LobbyBotStep {
  if (!roomHasLobbyBots(room) || room.status !== 'playing' || room.state.gameOver) return 'idle'
  const runtime = runtimeOf(room, now)
  if (now < runtime.nextAt) return 'waiting'

  if (runtime.turn !== room.state.turnNumber) {
    runtime.turn = room.state.turnNumber
    runtime.attempts.clear()
  }
  if (runtime.revision !== room.observationRevision) {
    runtime.revision = room.observationRevision
    runtime.since = now
    runtime.rejects = 0
    runtime.idle = false
    runtime.rescued = false
  }

  const bots = new Set(roomBotIds(room))
  let planned: PlannedBotAction | null = null
  if (!runtime.idle && runtime.rejects < MAX_REJECTS) {
    try {
      planned = planGreedyBotAction(room.state, room.map, bots, runtime.attempts)
    } catch (error) {
      debugLog('lobby-bot.plan-error', { roomId: room.id, error: String(error) })
    }
    // Состояние не меняется, пока кто-нибудь не сходит, — пересчитывать нечего.
    if (!planned) runtime.idle = true
  }
  if (!planned && !runtime.rescued && now - runtime.since >= STALL_MS) {
    runtime.rescued = true
    planned = rescueAction(room, bots)
    if (planned) debugLog('lobby-bot.rescue', { roomId: room.id, ...planned })
  }
  if (!planned) return 'idle'

  try {
    apply(room, planned.playerId, planned.actionId, planned.params)
  } catch (error) {
    runtime.rejects += 1
    debugLog('lobby-bot.rejected', {
      roomId: room.id,
      playerId: planned.playerId,
      actionId: planned.actionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return 'idle'
  }
  runtime.nextAt = now + (PAUSE_AFTER_MS[planned.actionId] ?? DEFAULT_PAUSE_MS)
  return 'acted'
}
