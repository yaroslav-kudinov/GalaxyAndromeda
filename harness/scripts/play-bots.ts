#!/usr/bin/env tsx
/**
 * Партия человека против ботов харнесса на живом сервере.
 *
 * Скрипт создаёт комнату, сажает ботов на все места, кроме места человека, и ждёт, пока
 * человек войдёт по ссылке. Когда места заняты — бот-хозяин начинает партию, дальше боты
 * решают на копии состояния (та же логика, что в замерах баланса) и шлют действия на сервер.
 *
 *   pnpm tsx harness/scripts/play-bots.ts --map reference-cross-4-13 [--human player-1]
 *   GAME_SERVER_URL=http://127.0.0.1:3001 (по умолчанию)
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyGameActionOnSnapshot,
  gameSnapshotFromObservation,
  normalizeMapDefinition,
} from '../../packages/rules/src/index.js'
import type { GameSnapshot, MapDefinition } from '../../packages/rules/src/index.js'
import { botStepLive, setActionSink, type MarkerAttempts } from '../balance/bot.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const API = (process.env.GAME_SERVER_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '') + '/api'
const CLIENT = (process.env.GAME_CLIENT_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const BOT_NAMES = ['Бот Альфа', 'Бот Бета', 'Бот Гамма', 'Бот Дельта', 'Бот Эпсилон']

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 ? process.argv[index + 1] ?? fallback : fallback
}

async function api<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(`${path}: ${body.error ?? res.status}`)
  return body
}

const post = <T = Record<string, unknown>>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) })

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

function loadMapRaw(name: string): Record<string, unknown> {
  for (const path of [
    resolve(HERE, '../balance/maps', `${name}.json`),
    resolve(HERE, '../../maps/bundled', `${name}.json`),
  ]) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      continue
    }
  }
  throw new Error(`Карта не найдена: ${name}`)
}

interface PlannedAction {
  playerId: string
  actionId: string
  params?: Record<string, unknown>
}

class Planned extends Error {
  constructor(readonly action: PlannedAction) {
    super('planned')
  }
}

/**
 * Какое действие бот сделал бы сейчас. Бот ходит по копии состояния; действия за человека
 * (бот в бою решает за обе стороны) применяются только к копии и не отправляются.
 */
function planNextBotAction(
  game: GameSnapshot,
  map: MapDefinition,
  botIds: ReadonlySet<string>,
  attempts: MarkerAttempts,
): PlannedAction | null {
  setActionSink((g, m, playerId, actionId, params) => {
    const result = applyGameActionOnSnapshot(g, m, playerId, actionId, params)
    if (!result.errors.length && botIds.has(playerId)) throw new Planned({ playerId, actionId, params })
    return result
  })
  try {
    botStepLive(game, map, botIds, attempts)
    return null
  } catch (e) {
    if (e instanceof Planned) return e.action
    throw e
  } finally {
    setActionSink(null)
  }
}

async function main(): Promise<void> {
  const mapName = flag('map', 'reference-cross-4-13')
  const humanSeat = flag('human', 'player-1')
  const raw = loadMapRaw(mapName)
  const map = normalizeMapDefinition(raw)
  const seats = Number((raw as { playerCount?: number }).playerCount ?? 2)

  const { roomId, code } = await post<{ roomId: string; code: string }>('/rooms', { map: raw, maxPlayers: seats })
  const botIds: string[] = []
  for (let i = 1; i <= seats; i++) {
    const seat = `player-${i}`
    if (seat === humanSeat) continue
    const joined = await post<{ playerId: string }>(`/rooms/${roomId}/join`, {
      playerName: BOT_NAMES[botIds.length] ?? `Бот ${i}`,
      preferredPlayerId: seat,
    })
    botIds.push(joined.playerId)
  }
  const bots = new Set(botIds)
  console.log(`Комната ${roomId}, код ${code}, карта «${map.name}»`)
  console.log(`Ваше место: ${humanSeat}. Боты: ${botIds.join(', ')}`)
  console.log(`Войти: ${CLIENT}/game/${roomId}`)

  // Ждём человека и начинаем.
  for (;;) {
    const boot = await api<{ playerCount: number; maxPlayers: number; status: string }>(`/rooms/${roomId}/bootstrap`)
    if (boot.status === 'playing') break
    if (boot.playerCount >= boot.maxPlayers) {
      await post(`/rooms/${roomId}/start`, { playerId: botIds[0] })
      console.log('Все на местах — партия началась')
      break
    }
    await sleep(1000)
  }

  const attempts: MarkerAttempts = new Map()
  let lastLine = ''
  for (;;) {
    const obs = await api<{ mechanics: Record<string, unknown> }>(
      `/rooms/${roomId}/state?playerId=${botIds[0]}&geometry=0`,
    )
    const mech = obs.mechanics
    if (mech.gameOver) {
      console.log('Партия окончена:', JSON.stringify(mech.gameOver))
      return
    }
    const game = gameSnapshotFromObservation(
      mech as unknown as Parameters<typeof gameSnapshotFromObservation>[0],
      undefined,
      map,
    )
    const planned = planNextBotAction(game, map, bots, attempts)
    if (!planned) {
      await sleep(700)
      continue
    }
    try {
      await post(`/rooms/${roomId}/action?geometry=0`, {
        playerId: planned.playerId,
        action: { actionId: planned.actionId, params: planned.params },
      })
      const line = `ход ${String(mech.turnNumber)} ${String(mech.phase)}: ${planned.playerId} ${planned.actionId}`
      if (line !== lastLine) console.log(line)
      lastLine = line
      await sleep(350)
    } catch (e) {
      // Сервер мог уйти вперёд (отсчёт боя, ход человека) — пересчитаем на свежем состоянии.
      console.log(`  отклонено: ${planned.playerId} ${planned.actionId} — ${(e as Error).message}`)
      await sleep(1000)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
