#!/usr/bin/env tsx
/**
 * Сквозная проверка ботов лобби на живом сервере: хозяин сажает ботов на все места, кроме
 * своего, начинает партию и играет через обычный HTTP-вход (решает за него тот же жадный бот).
 * Партия должна дойти до конца: боты сервера ходят сами и ждут человека в бою.
 *
 *   GAME_SERVER_URL=http://127.0.0.1:3001 pnpm tsx harness/scripts/simulate-lobby-bots.ts [--map trio-start]
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  gameSnapshotFromObservation,
  normalizeMapDefinition,
  planGreedyBotAction,
  type MarkerAttempts,
} from '../../packages/rules/src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const API = (process.env.GAME_SERVER_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '') + '/api'
/** Партия стоит дольше этого — считаем, что она зависла. */
const STALL_MS = 60_000

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

async function main(): Promise<void> {
  const mapName = flag('map', 'trio-start')
  const raw = JSON.parse(readFileSync(resolve(HERE, '../../maps/bundled', `${mapName}.json`), 'utf8'))
  const map = normalizeMapDefinition(raw)
  const seats = Number((raw as { playerCount?: number }).playerCount ?? 2)

  const { roomId } = await post<{ roomId: string }>('/rooms', { map: raw, maxPlayers: seats })
  const { playerId } = await post<{ playerId: string }>(`/rooms/${roomId}/join`, {
    playerName: 'Прогон',
    preferredPlayerId: 'player-1',
  })
  for (let i = 1; i < seats; i++) await post(`/rooms/${roomId}/bots`, { playerId })
  await post(`/rooms/${roomId}/start`, { playerId })
  console.log(`Комната ${roomId}, карта «${map.name}», мест ${seats}`)

  const attempts: MarkerAttempts = new Map()
  const me = new Set([playerId])
  let lastPresence = 0
  let lastRevision = -1
  let changedAt = Date.now()
  let actions = 0
  let battlesWithMe = 0
  let lastBattleKey = ''
  for (;;) {
    if (Date.now() - lastPresence > 5_000) {
      await post(`/rooms/${roomId}/presence`, { playerId, playerName: 'Прогон' })
      lastPresence = Date.now()
    }
    const obs = await api<{ mechanics: Record<string, unknown>; revision?: number }>(
      `/rooms/${roomId}/state?playerId=${playerId}&geometry=0`,
    )
    const mech = obs.mechanics
    if (mech.gameOver) {
      console.log(`Партия окончена на ходу ${String(mech.turnNumber)}:`, JSON.stringify(mech.gameOver))
      console.log(`Действий человека: ${actions}, боёв с его участием: ${battlesWithMe}`)
      return
    }
    const revision = Number(mech.observationRevision ?? obs.revision ?? -1)
    if (revision !== lastRevision) {
      lastRevision = revision
      changedAt = Date.now()
    } else if (Date.now() - changedAt > STALL_MS) {
      throw new Error(`Партия стоит ${STALL_MS / 1000} с: ход ${String(mech.turnNumber)}, ${String(mech.phase)}, активен ${String(mech.activePlayerId)}`)
    }
    const pending = mech.pendingCombat as { attackerId?: string; defenderIds?: string[]; cellKey?: string } | null
    if (pending && (pending.attackerId === playerId || pending.defenderIds?.includes(playerId))) {
      const key = `${String(mech.turnNumber)}:${pending.attackerId}:${pending.defenderIds?.join(',')}`
      if (key !== lastBattleKey) battlesWithMe += 1
      lastBattleKey = key
    }

    const game = gameSnapshotFromObservation(
      mech as unknown as Parameters<typeof gameSnapshotFromObservation>[0],
      undefined,
      map,
    )
    const planned = planGreedyBotAction(game, map, me, attempts)
    if (!planned) {
      await sleep(300)
      continue
    }
    try {
      await post(`/rooms/${roomId}/action?geometry=0`, {
        playerId,
        action: { actionId: planned.actionId, params: planned.params },
      })
      actions += 1
    } catch (e) {
      // Боты сервера могли уйти вперёд — пересчитаем на свежем состоянии.
      console.log(`  отклонено: ${planned.actionId} — ${(e as Error).message}`)
      await sleep(500)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
