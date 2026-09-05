import type { FastifyInstance } from 'fastify'

import type {

  ActionPayload,

  GameObservation,

  GameSnapshot,

  MapDefinition,

} from '@galaxy/rules'

import {

  buildObservation,

  gameSnapshotFromMap,

  getLegalActionsForSnapshot,

  applyGameActionOnSnapshot,

  resolveCombatPrep,

  combatPrepOf,

  releaseInvalidPendingCombat,

  tickCombatPrepCountdown,

  syncParticipatingPlayerIds,

  normalizeGalaxySave,

  parseGalaxySave,

  validateGalaxySave,

  ensureActivePlayerParticipating,

  ensurePlayerSlots,

  resolveMapPlayerCount,

  resolveJoinPlayerId,

  resolveRejoinPlayerId,

  freeLobbyPlayerIds,

  beginMatchForParticipants,
  isPristineMatchSnapshot,
  type GalaxySaveFile,

} from '@galaxy/rules'

import { debugLoggingEnabled, debugLog, getDebugLogs } from './debug-log.js'

import {
  deletePersistedRoom,
  loadPersistedRooms,
  scheduleRoomPersist,
} from './room-persistence.js'



export interface Room {

  id: string

  code: string

  map: MapDefinition

  state: GameSnapshot

  playerIds: string[]

  maxPlayers: number

  /** Пока 'lobby' — ждём игроков; партия не идёт. */
  status: 'lobby' | 'playing'

  /** Первый вошедший; только он стартует матч. */
  hostPlayerId: string | null

  /** Последний результат боя — в observation до следующего действия (кроме update-combat-prep) */
  lastCombatResult?: import('@galaxy/rules').CombatResolutionResult

  /** Монотонный счётчик изменений состояния для клиентской синхронизации */
  observationRevision: number

  /** Последняя активность (создание, join, presence, действие) — для чистки пустых лобби */
  lastActivityAt: number

  /** Когда зафиксирована победа — для автозакрытия комнаты через 30 с */
  gameOverAt?: number | null

}

interface PlayerPresence {

  playerId: string

  playerName: string

  lastSeen: number

}

const rooms = new Map<string, Room>()

/**
 * Поднимает dev-комнаты с диска (`.dev-rooms/`). Вызывается один раз при старте сервера,
 * чтобы рестарт `tsx watch` не терял живые партии.
 */
export function restoreRoomsFromDisk(): number {
  let restored = 0
  for (const room of loadPersistedRooms()) {
    if (rooms.has(room.id)) continue
    rooms.set(room.id, room)
    maybeScheduleVictoryRoomClose(room)
    restored += 1
  }
  return restored
}

const presenceByRoom = new Map<string, Map<string, PlayerPresence>>()

/** Игрок «онлайн», если страница игры слала heartbeat недавно */
export const PRESENCE_TTL_MS = 20_000

/** Пустое лобби без активности дольше этого времени удаляется */
export const EMPTY_LOBBY_TTL_MS = 30 * 60 * 1000

/** Как часто проверяем пустые лобби */
const EMPTY_LOBBY_SWEEP_MS = 60_000

/** После победы комната удаляется через это время */
export const VICTORY_ROOM_CLOSE_MS = 30_000

const victoryCloseTimers = new Map<string, NodeJS.Timeout>()

function clearVictoryCloseTimer(roomId: string): void {
  const timer = victoryCloseTimers.get(roomId)
  if (timer) {
    clearTimeout(timer)
    victoryCloseTimers.delete(roomId)
  }
}

function maybeScheduleVictoryRoomClose(room: Room): void {
  if (!room.state.gameOver) return
  if (victoryCloseTimers.has(room.id)) return

  if (!room.gameOverAt) {
    room.gameOverAt = Date.now()
    scheduleRoomPersist(room)
  }

  const elapsed = Date.now() - room.gameOverAt
  const delay = Math.max(0, VICTORY_ROOM_CLOSE_MS - elapsed)
  const timer = setTimeout(() => {
    victoryCloseTimers.delete(room.id)
    destroyRoom(room.id, 'victory-timeout')
  }, delay)
  timer.unref?.()
  victoryCloseTimers.set(room.id, timer)
  debugLog('room.victory-close.scheduled', {
    roomId: room.id,
    delayMs: delay,
    gameOverAt: room.gameOverAt,
  })
}

function touchRoomActivity(room: Room, at = Date.now()): void {
  room.lastActivityAt = at
}

function touchPresence(roomId: string, playerId: string, playerName: string): void {
  let roomPresence = presenceByRoom.get(roomId)
  if (!roomPresence) {
    roomPresence = new Map()
    presenceByRoom.set(roomId, roomPresence)
  }
  const now = Date.now()
  roomPresence.set(playerId, {
    playerId,
    playerName,
    lastSeen: now,
  })
  const room = rooms.get(roomId)
  if (room) touchRoomActivity(room, now)
}

function countActivePlayers(roomId: string, now = Date.now()): number {
  const roomPresence = presenceByRoom.get(roomId)
  if (!roomPresence) return 0
  let count = 0
  for (const entry of roomPresence.values()) {
    if (now - entry.lastSeen <= PRESENCE_TTL_MS) count += 1
  }
  return count
}

function destroyRoom(roomId: string, reason: string): boolean {
  const room = rooms.get(roomId)
  if (!room) return false
  clearVictoryCloseTimer(roomId)
  rooms.delete(roomId)
  presenceByRoom.delete(roomId)
  deletePersistedRoom(roomId)
  debugLog('room.destroy', {
    roomId,
    code: room.code,
    reason,
    playerCount: room.playerIds.length,
    idleMs: Date.now() - room.lastActivityAt,
  })
  return true
}

/**
 * Удаляет пустые лобби без онлайн-игроков, если активности не было дольше получаса.
 * «Пустое» = никто не шлёт presence (все вкладки закрыты / никто не зашёл).
 */
export function purgeInactiveEmptyLobbies(now = Date.now()): string[] {
  const removed: string[] = []
  for (const room of [...rooms.values()]) {
    if (countActivePlayers(room.id, now) > 0) continue
    if (now - room.lastActivityAt < EMPTY_LOBBY_TTL_MS) continue
    if (destroyRoom(room.id, 'empty-lobby-ttl')) removed.push(room.id)
  }
  if (removed.length) {
    debugLog('rooms.purge', { removed: removed.length, roomIds: removed, ttlMs: EMPTY_LOBBY_TTL_MS })
  }
  return removed
}

let lobbyJanitorTimer: NodeJS.Timeout | null = null

/** Фоновая чистка пустых лобби; безопасна при повторном вызове. */
export function startEmptyLobbyJanitor(): void {
  if (lobbyJanitorTimer) return
  lobbyJanitorTimer = setInterval(() => {
    purgeInactiveEmptyLobbies()
  }, EMPTY_LOBBY_SWEEP_MS)
  lobbyJanitorTimer.unref?.()
  // Сразу после старта подчищаем зомби из `.dev-rooms`, пролежавшие дольше TTL.
  purgeInactiveEmptyLobbies()
}

function isPlayerActive(roomId: string, playerId: string, now = Date.now()): boolean {
  const entry = presenceByRoom.get(roomId)?.get(playerId)
  if (!entry) return false
  return now - entry.lastSeen <= PRESENCE_TTL_MS
}

export function listLobbies(now = Date.now()) {
  return [...rooms.values()].map((room) => {
    ensureRoomParticipatingSynced(room)
    const slots = room.state.players.slice(0, room.maxPlayers).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      joined: room.playerIds.includes(p.id),
      active: isPlayerActive(room.id, p.id, now),
    }))
    return {
      roomId: room.id,
      code: room.code,
      mapId: room.map.id,
      mapName: room.map.name,
      maxPlayers: room.maxPlayers,
      playerCount: room.playerIds.length,
      status: room.status,
      hostPlayerId: room.hostPlayerId,
      phase: room.status === 'lobby' ? 'lobby' : room.state.phase,
      turnNumber: room.state.turnNumber,
      activePlayerId: room.state.activePlayerId,
      players: slots,
    }
  })
}



function randomCode(): string {

  return Math.random().toString(36).slice(2, 8).toUpperCase()

}



function wantsFullGeometry(raw: string | undefined): boolean {

  return raw === '1' || raw === 'true'

}

function bumpObservationRevision(room: Room, reason: string): void {
  room.observationRevision += 1
  touchRoomActivity(room)
  debugLog('observation.revision', {
    roomId: room.id,
    revision: room.observationRevision,
    reason,
  })
  // Ревизия растёт на каждой мутации состояния — удобная единая точка для персиста.
  scheduleRoomPersist(room)
}

function maybeAdvanceCombatPrep(room: Room): {
  combatResult?: import('@galaxy/rules').CombatResolutionResult
  changed: boolean
} {
  const pendingBefore = room.state.pendingCombat
  const prepBefore = combatPrepOf(pendingBefore)
  const attackerId = pendingBefore?.attackerId
  const defenderId = pendingBefore?.defenderIds?.[0] ?? combatPrepOf(pendingBefore)?.defenderId
  if (!tickCombatPrepCountdown(room.state)) return { changed: false }
  const { errors, combatResult } = resolveCombatPrep(room.state, room.map)
  if (errors.length) {
    debugLog('combat.auto-resolve.error', { roomId: room.id, error: errors[0] })
    return { changed: true }
  }
  if (combatResult) room.lastCombatResult = combatResult
  const loserId =
    combatResult?.winnerId == null
      ? undefined
      : combatResult.winnerId === attackerId
        ? defenderId
        : attackerId
  const shieldAbsorbEntry = combatResult?.log.find((e) => e.step === 'shield-absorb')
  const shieldContributions = (shieldAbsorbEntry?.data as { contributions?: unknown[] } | undefined)?.contributions
  debugLog(combatResult ? 'combat.auto-resolve' : 'combat.countdown', {
    roomId: room.id,
    phaseBefore: prepBefore?.phase,
    countdownStartedAt: prepBefore?.countdownStartedAt,
    phaseAfter: combatPrepOf(room.state.pendingCombat)?.phase ?? null,
    winnerId: combatResult?.winnerId,
    attackerId,
    defenderId,
    loserId,
    shieldAbsorbed: combatResult?.shieldAbsorbed,
    rawDamage: combatResult?.rawDamage,
    shieldContributionCount: Array.isArray(shieldContributions) ? shieldContributions.length : undefined,
  })
  return { combatResult, changed: true }
}

function actionErrorStatus(message: string): 400 | 403 | 422 {
  if (message.includes('не зарегистрирован')) return 403
  if (
    message.includes('Недостаточно фишек')
    || message.includes('Некоррект')
    || message.includes('не участник')
    || message.includes('Нет подготовки')
    || message.includes('Priority skip')
    || message.includes('не может')
    || message.includes('уже идёт')
    || message.includes('завершена')
  ) {
    return 422
  }
  return 400
}

function roomObservation(
  room: Room,
  playerId: string,
  includeGeometry: boolean,
): GameObservation {
  const legal = room.status === 'playing'
    ? getLegalActionsForSnapshot(room.state, room.map.id, playerId)
    : []
  const s = room.state

  const state: Record<string, unknown> = {
    mapId: room.map.id,
    phase: s.phase,
    turnNumber: s.turnNumber,
    activePlayerId: s.activePlayerId,
    players: s.players,
    cells: s.cells,
    eventLog: s.eventLog,
    actionMarkers: s.actionMarkers,
    productionMarkers: s.productionMarkers,
    actionMarkerResolvedThisTurn: s.actionMarkerResolvedThisTurn ?? false,
    productionMarkerResolvedThisTurn: s.productionMarkerResolvedThisTurn ?? false,
    participatingPlayerIds: s.participatingPlayerIds,
    turnEvent: s.turnEvent ?? null,
    eventDeck: s.eventDeck ?? null,
    gameOver: s.gameOver ?? null,
    pendingCombat: s.pendingCombat ?? null,
    productionTokensSpentThisTurn: s.productionTokensSpentThisTurn ?? null,
    overtimeRegionByPlayer: s.overtimeRegionByPlayer ?? null,
    actionMarkerLimitByPlayer: s.actionMarkerLimitByPlayer ?? null,
    productionMarkerLimitByPlayer: s.productionMarkerLimitByPlayer ?? null,
    resourceRechargeTurnsRemaining:
      room.status === 'playing' ? (s.resourceRechargeTurnsRemaining ?? null) : undefined,
    lastCombatResult: room.lastCombatResult ?? null,
    observationRevision: room.observationRevision,
    roomStatus: room.status,
    hostPlayerId: room.hostPlayerId,
  }

  return buildObservation(state as unknown as Parameters<typeof buildObservation>[0], legal, {
    geometry: includeGeometry,
  })
}



export function createRoom(map: MapDefinition, maxPlayers = 6): Room {

  const id = crypto.randomUUID()

  const effectiveMax = Math.min(maxPlayers, resolveMapPlayerCount(map))

  const state = gameSnapshotFromMap(map)
  ensurePlayerSlots(state, effectiveMax)
  state.participatingPlayerIds = []

  const room: Room = {

    id,

    code: randomCode(),

    map,

    state,

    playerIds: [],

    maxPlayers: effectiveMax,

    status: 'lobby',

    hostPlayerId: null,

    observationRevision: 0,

    lastActivityAt: Date.now(),

  }

  rooms.set(id, room)
  scheduleRoomPersist(room)
  debugLog('room.create', { roomId: id, code: room.code, maxPlayers: effectiveMax })

  return room

}

export function createRoomFromSave(save: GalaxySaveFile, maxPlayers = 6): Room {
  if (!save.game) throw new Error('Save has no game state')

  const errors = validateGalaxySave(save)
  if (errors.length) throw new Error(errors[0])

  const effectiveMax = Math.min(
    maxPlayers,
    resolveMapPlayerCount(save.map),
    save.game.players.length,
  )

  const state = JSON.parse(JSON.stringify(save.game)) as GameSnapshot
  ensurePlayerSlots(state, effectiveMax)
  state.participatingPlayerIds = []
  ensureActivePlayerParticipating(state)

  const id = crypto.randomUUID()
  const room: Room = {
    id,
    code: randomCode(),
    map: save.map,
    state,
    playerIds: [],
    maxPlayers: effectiveMax,
    status: 'lobby',
    hostPlayerId: null,
    observationRevision: 0,
    lastActivityAt: Date.now(),
  }

  rooms.set(id, room)
  scheduleRoomPersist(room)
  debugLog('room.create', { roomId: id, code: room.code, maxPlayers: effectiveMax, source: 'save' })
  return room
}



export function getRoom(id: string): Room | undefined {

  return rooms.get(id)

}



export type RoomJoinFailure = {
  ok: false
  error: string
  availablePlayerIds: string[]
}

export type RoomJoinSuccess = {
  ok: true
  playerId: string
  room: Room
}

export type RoomJoinResult = RoomJoinSuccess | RoomJoinFailure

function assignPlayerToSlot(room: Room, playerId: string, playerName: string): boolean {
  const existing = room.state.players.find((p) => p.id === playerId)
  if (!existing) return false

  const name = playerName.trim() || existing.name
  existing.name = name
  existing.isAi = false

  if (!room.playerIds.includes(playerId)) {
    room.playerIds.push(playerId)
  }
  if (!room.hostPlayerId) room.hostPlayerId = playerId
  if (!room.state.activePlayerId) room.state.activePlayerId = playerId

  syncParticipatingPlayerIds(room.state, room.playerIds)
  touchPresence(room.id, playerId, name)
  scheduleRoomPersist(room)
  return true
}

export function joinRoom(
  roomId: string,
  playerName: string,
  preferredPlayerId?: string,
): RoomJoinResult {
  const room = rooms.get(roomId)
  if (!room) {
    return { ok: false, error: 'Комната не найдена', availablePlayerIds: [] }
  }

  if (room.status === 'playing') {
    return {
      ok: false,
      error: 'Игра уже началась — новые слоты закрыты',
      availablePlayerIds: [],
    }
  }

  const resolved = resolveJoinPlayerId(room.playerIds, room.maxPlayers, preferredPlayerId)
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      availablePlayerIds: resolved.availablePlayerIds,
    }
  }

  if (!assignPlayerToSlot(room, resolved.playerId, playerName)) {
    return {
      ok: false,
      error: 'Слот не найден',
      availablePlayerIds: freeLobbyPlayerIds(room.playerIds, room.maxPlayers),
    }
  }

  debugLog('room.join', { roomId, playerId: resolved.playerId, playerName: playerName.trim() || undefined })
  return { ok: true, playerId: resolved.playerId, room }
}

export function rejoinRoom(
  roomId: string,
  playerId: string,
  playerName?: string,
  preferredPlayerId?: string,
): RoomJoinResult {
  const room = rooms.get(roomId)
  if (!room) {
    return { ok: false, error: 'Комната не найдена', availablePlayerIds: [] }
  }

  const resolved = resolveRejoinPlayerId(
    playerId,
    room.playerIds,
    room.maxPlayers,
    preferredPlayerId,
  )
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      availablePlayerIds: resolved.availablePlayerIds,
    }
  }

  if (room.status === 'playing' && resolved.previousPlayerId) {
    return {
      ok: false,
      error: 'После старта слот менять нельзя',
      availablePlayerIds: freeLobbyPlayerIds(room.playerIds, room.maxPlayers),
    }
  }

  if (resolved.previousPlayerId) {
    room.playerIds = room.playerIds.filter((id) => id !== resolved.previousPlayerId)
    if (room.hostPlayerId === resolved.previousPlayerId) {
      room.hostPlayerId = resolved.playerId
    }
    syncParticipatingPlayerIds(room.state, room.playerIds)
  }

  if (!assignPlayerToSlot(room, resolved.playerId, playerName ?? '')) {
    return {
      ok: false,
      error: 'Слот не найден',
      availablePlayerIds: freeLobbyPlayerIds(room.playerIds, room.maxPlayers),
    }
  }

  debugLog('room.rejoin', {
    roomId,
    playerId: resolved.playerId,
    previousPlayerId: resolved.previousPlayerId,
    playerName: playerName?.trim() || undefined,
  })
  return { ok: true, playerId: resolved.playerId, room }
}

export type RoomStartFailure = { ok: false; error: string }
export type RoomStartResult = { ok: true; room: Room } | RoomStartFailure

export function startRoom(roomId: string, playerId: string): RoomStartResult {
  const room = rooms.get(roomId)
  if (!room) return { ok: false, error: 'Комната не найдена' }
  if (room.status === 'playing') return { ok: false, error: 'Игра уже началась' }
  if (!room.playerIds.includes(playerId)) {
    return { ok: false, error: 'Игрок не зарегистрирован в комнате' }
  }
  if (room.hostPlayerId && room.hostPlayerId !== playerId) {
    return { ok: false, error: 'Начать игру может только создатель комнаты' }
  }
  if (!room.playerIds.length) {
    return { ok: false, error: 'В комнате нет игроков' }
  }

  room.hostPlayerId = room.hostPlayerId ?? playerId
  syncParticipatingPlayerIds(room.state, room.playerIds)
  if (isPristineMatchSnapshot(room.state)) {
    beginMatchForParticipants(room.state, room.map.id, room.playerIds)
  } else {
    ensureActivePlayerParticipating(room.state)
  }
  room.status = 'playing'
  bumpObservationRevision(room, 'room.start')
  debugLog('room.start', {
    roomId,
    hostPlayerId: room.hostPlayerId,
    players: room.playerIds,
    activePlayerId: room.state.activePlayerId,
  })
  return { ok: true, room }
}

export function reportPresence(
  roomId: string,
  playerId: string,
  playerName: string,
): boolean {
  const room = rooms.get(roomId)
  if (!room || !room.playerIds.includes(playerId)) return false
  const wasActive = isPlayerActive(roomId, playerId)
  touchPresence(roomId, playerId, playerName.trim() || playerId)
  if (!wasActive) {
    debugLog('presence.online', { roomId, playerId, playerName: playerName.trim() || playerId })
  }
  return true
}

function assertRoomMember(room: Room, playerId: string): void {
  if (!room.playerIds.includes(playerId)) {
    throw new Error('Игрок не зарегистрирован в комнате')
  }
}

function ensureRoomParticipatingSynced(room: Room): void {
  if (!room.state.participatingPlayerIds?.length && room.playerIds.length) {
    syncParticipatingPlayerIds(room.state, room.playerIds)
  }
}



export function getObservation(

  room: Room,

  playerId: string,

  includeGeometry = true,

): GameObservation {

  ensureRoomParticipatingSynced(room)
  assertRoomMember(room, playerId)

  const advanced = maybeAdvanceCombatPrep(room)
  if (advanced.changed) bumpObservationRevision(room, 'combat-countdown')
  maybeScheduleVictoryRoomClose(room)
  return roomObservation(room, playerId, includeGeometry)

}



export function submitAction(

  room: Room,

  playerId: string,

  action: ActionPayload,

  includeGeometry = true,

): GameObservation {

  ensureRoomParticipatingSynced(room)
  assertRoomMember(room, playerId)

  if (room.status !== 'playing') {
    throw new Error('Игра ещё не начата — дождитесь старта в комнате подготовки')
  }

  if (room.state.gameOver) {
    throw new Error('Игра завершена')
  }

  // Бой, не проходящий инвариант, блокирует всю комнату: снимаем его до того,
  // как игрок упрётся в «Сначала завершите текущий бой».
  const violations = releaseInvalidPendingCombat(room.state)
  if (violations.length) {
    debugLog('combat.invariant.released', { roomId: room.id, violations })
    bumpObservationRevision(room, 'combat:invariant-released')
  }

  if (action.actionId !== 'update-combat-prep') {
    // lastCombatResult оставляем до старта следующего боя — иначе наблюдатели
    // с более редким poll могут не успеть увидеть броски.
  }
  const prepBefore = combatPrepOf(room.state.pendingCombat)
  const pendingPhaseBefore = room.state.pendingCombat?.phase

  const { errors, combatResult: actionCombatResult } = applyGameActionOnSnapshot(
    room.state,
    room.map,
    playerId,
    action.actionId,
    action.params,
  )

  if (errors.length) throw new Error(errors[0])

  if (
    room.state.pendingCombat?.phase === 'prep'
    && pendingPhaseBefore !== 'prep'
  ) {
    room.lastCombatResult = undefined
  }

  if (actionCombatResult) room.lastCombatResult = actionCombatResult

  const advanced = maybeAdvanceCombatPrep(room)
  if (actionCombatResult) room.lastCombatResult = actionCombatResult
  if (advanced.combatResult) room.lastCombatResult = advanced.combatResult

  bumpObservationRevision(room, `action:${action.actionId}`)
  if (action.actionId === 'update-combat-prep') {
    const prep = combatPrepOf(room.state.pendingCombat)
    debugLog('combat.prep', {
      roomId: room.id,
      playerId,
      ready: action.params?.ready,
      phaseBefore: prepBefore?.phase,
      phaseAfter: prep?.phase ?? null,
      countdownStartedAt: prep?.countdownStartedAt ?? null,
      readyBy: prep?.readyBy ?? null,
    })
  }

  maybeScheduleVictoryRoomClose(room)
  return roomObservation(room, playerId, includeGeometry)

}

export type RoomCloseFailure = { ok: false; error: string }
export type RoomCloseResult = { ok: true } | RoomCloseFailure

/** Создатель закрывает комнату подготовки до старта партии. */
export function closeRoom(roomId: string, playerId: string): RoomCloseResult {
  const room = rooms.get(roomId)
  if (!room) return { ok: false, error: 'Комната не найдена' }
  if (room.status !== 'lobby') {
    return { ok: false, error: 'Закрыть можно только комнату подготовки до начала игры' }
  }
  if (!room.playerIds.includes(playerId)) {
    return { ok: false, error: 'Игрок не зарегистрирован в комнате' }
  }
  if (room.hostPlayerId && room.hostPlayerId !== playerId) {
    return { ok: false, error: 'Закрыть комнату может только создатель' }
  }
  destroyRoom(roomId, 'host-close')
  debugLog('room.close', { roomId, playerId })
  return { ok: true }
}



export function registerHttpRoutes(app: FastifyInstance): void {
  startEmptyLobbyJanitor()

  app.get('/health', async () => ({ ok: true, service: '@galaxy/server' }))

  app.addHook('onResponse', async (req, reply) => {
    if (reply.statusCode >= 400) {
      debugLog('http.error', {
        method: req.method,
        path: req.routeOptions.url,
        statusCode: reply.statusCode,
        roomId: (req.params as { id?: string } | undefined)?.id,
      })
    }
  })

  if (debugLoggingEnabled) {
    app.get<{ Querystring: { roomId?: string } }>('/debug/logs', async (req) => ({
      logs: getDebugLogs(req.query.roomId),
    }))
  }

  app.get('/lobbies', async () => ({
    lobbies: listLobbies(),
    presenceTtlMs: PRESENCE_TTL_MS,
  }))

  app.post<{ Params: { id: string }; Body: { playerId: string; playerName: string } }>(
    '/rooms/:id/presence',
    async (req, reply) => {
      const ok = reportPresence(req.params.id, req.body.playerId, req.body.playerName)
      if (!ok) return reply.status(403).send({ error: 'Игрок не зарегистрирован в комнате' })
      return { ok: true }
    },
  )

  app.post<{
    Params: { id: string }
    Body: { playerId: string; playerName?: string; preferredPlayerId?: string }
  }>(
    '/rooms/:id/rejoin',
    async (req, reply) => {
      const result = rejoinRoom(
        req.params.id,
        req.body.playerId,
        req.body.playerName,
        req.body.preferredPlayerId,
      )
      if (!result.ok) {
        return reply.status(400).send({
          error: result.error,
          availablePlayerIds: result.availablePlayerIds,
        })
      }
      return { playerId: result.playerId, code: result.room.code }
    },
  )

  app.post<{ Body: { map?: MapDefinition; maxPlayers?: number; save?: unknown } }>('/rooms', async (req, reply) => {
    if (req.body.save != null) {
      let normalized: GalaxySaveFile
      try {
        normalized = normalizeGalaxySave(parseGalaxySave(req.body.save))
      } catch {
        return reply.status(400).send({ error: 'Некорректный формат сохранения' })
      }
      try {
        const room = createRoomFromSave(normalized, req.body.maxPlayers ?? 6)
        return { roomId: room.id, code: room.code }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Cannot create room from save'
        return reply.status(400).send({ error: msg })
      }
    }

    if (!req.body.map) {
      return reply.status(400).send({ error: 'Need map or save in request body' })
    }

    const room = createRoom(req.body.map, req.body.maxPlayers ?? 6)

    return { roomId: room.id, code: room.code }

  })



  app.post<{
    Params: { id: string }
    Body: { playerName: string; preferredPlayerId?: string }
  }>(
    '/rooms/:id/join',
    async (req, reply) => {
      const result = joinRoom(
        req.params.id,
        req.body.playerName,
        req.body.preferredPlayerId,
      )
      if (!result.ok) {
        return reply.status(400).send({
          error: result.error,
          availablePlayerIds: result.availablePlayerIds,
        })
      }
      return { playerId: result.playerId, code: result.room.code }
    },
  )

  app.post<{
    Params: { id: string }
    Body: { playerId: string }
  }>(
    '/rooms/:id/start',
    async (req, reply) => {
      const result = startRoom(req.params.id, req.body.playerId)
      if (!result.ok) return reply.status(400).send({ error: result.error })
      return { ok: true, code: result.room.code, status: result.room.status }
    },
  )

  app.post<{
    Params: { id: string }
    Body: { playerId: string }
  }>(
    '/rooms/:id/close',
    async (req, reply) => {
      const result = closeRoom(req.params.id, req.body.playerId)
      if (!result.ok) return reply.status(400).send({ error: result.error })
      return { ok: true }
    },
  )



  app.get<{ Params: { id: string } }>('/rooms/:id/bootstrap', async (req, reply) => {

    const room = getRoom(req.params.id)

    if (!room) return reply.status(404).send({ error: 'Room not found' })

    ensureRoomParticipatingSynced(room)

    return {
      roomId: room.id,
      code: room.code,
      map: room.map,
      maxPlayers: room.maxPlayers,
      playerCount: room.playerIds.length,
      status: room.status,
      hostPlayerId: room.hostPlayerId,
      joinedPlayerIds: [...room.playerIds],
      players: room.state.players.slice(0, room.maxPlayers).map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        joined: room.playerIds.includes(p.id),
      })),
      availablePlayerIds: freeLobbyPlayerIds(room.playerIds, room.maxPlayers),
    }

  })



  app.get<{ Params: { id: string }; Querystring: { playerId: string; geometry?: string } }>(

    '/rooms/:id/state',

    async (req, reply) => {

      const room = getRoom(req.params.id)

      if (!room) return reply.status(404).send({ error: 'Room not found' })

      const includeGeometry = wantsFullGeometry(req.query.geometry)

      try {
        return getObservation(room, req.query.playerId, includeGeometry)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return reply.status(actionErrorStatus(msg)).send({ error: msg })
      }

    },

  )



  app.get<{ Params: { id: string }; Querystring: { playerId: string } }>(

    '/rooms/:id/legal-actions',

    async (req, reply) => {

      const room = getRoom(req.params.id)

      if (!room) return reply.status(404).send({ error: 'Room not found' })

      if (!room.playerIds.includes(req.query.playerId)) {
        return reply.status(403).send({ error: 'Игрок не зарегистрирован в комнате' })
      }

      if (room.status !== 'playing') return []

      return getLegalActionsForSnapshot(room.state, room.map.id, req.query.playerId)

    },

  )



  app.get<{ Params: { id: string } }>('/rooms/:id/action', async (_req, reply) => {
    return reply
      .header('Allow', 'POST')
      .status(405)
      .send({ error: 'Действие игры принимается только POST-запросом. Проверьте прокси или перенаправление.' })
  })



  app.post<{

    Params: { id: string }

    Querystring: { geometry?: string }

    Body: { playerId: string; action: ActionPayload }

  }>(

    '/rooms/:id/action',

    async (req, reply) => {

      const room = getRoom(req.params.id)

      if (!room) return reply.status(404).send({ error: 'Room not found' })

      try {

        const includeGeometry = wantsFullGeometry(req.query.geometry)

        const observation = submitAction(room, req.body.playerId, req.body.action, includeGeometry)
        debugLog('action.ok', {
          roomId: room.id,
          playerId: req.body.playerId,
          actionId: req.body.action.actionId,
          revision: room.observationRevision,
        })
        return observation

      } catch (e) {

        const msg = e instanceof Error ? e.message : String(e)
        debugLog('action.error', {
          roomId: room.id,
          playerId: req.body.playerId,
          actionId: req.body.action?.actionId,
          error: msg,
        })
        return reply.status(actionErrorStatus(msg)).send({ error: msg })

      }

    },

  )



  app.get<{ Params: { id: string } }>('/rooms/:id/events', async (req, reply) => {

    const room = getRoom(req.params.id)

    if (!room) return reply.status(404).send({ error: 'Room not found' })

    return room.state.eventLog.slice(-20)

  })

}


