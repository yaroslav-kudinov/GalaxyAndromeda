import type { FastifyInstance } from 'fastify'
import type {
  ActionPayload,
  GameObservation,
  GameState,
  LegalAction,
  MapDefinition,
} from '@galaxy/rules'
import {
  buildObservation,
  gameStateFromMap,
  getLegalActions,
} from '@galaxy/rules'

export interface Room {
  id: string
  code: string
  map: MapDefinition
  state: GameState
  playerIds: string[]
  maxPlayers: number
}

const rooms = new Map<string, Room>()

function randomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export function createRoom(map: MapDefinition, maxPlayers = 6): Room {
  const id = crypto.randomUUID()
  const room: Room = {
    id,
    code: randomCode(),
    map,
    state: gameStateFromMap(map),
    playerIds: [],
    maxPlayers,
  }
  rooms.set(id, room)
  return room
}

export function getRoom(id: string): Room | undefined {
  return rooms.get(id)
}

export function joinRoom(roomId: string, playerName: string): { playerId: string; room: Room } | null {
  const room = rooms.get(roomId)
  if (!room || room.playerIds.length >= room.maxPlayers) return null

  const playerId = `player-${room.playerIds.length + 1}`
  room.playerIds.push(playerId)
  room.state.players.push({
    id: playerId,
    name: playerName,
    color: ['#3B82F6', '#22C55E', '#EF4444', '#A855F7', '#F59E0B', '#06B6D4'][room.playerIds.length - 1] ?? '#888',
    isAi: false,
    eliminated: false,
  })
  if (!room.state.activePlayerId) room.state.activePlayerId = playerId
  return { playerId, room }
}

export function getObservation(room: Room, playerId: string): GameObservation {
  const legal = getLegalActions(room.state, playerId)
  return buildObservation(room.state, legal)
}

export function submitAction(room: Room, playerId: string, action: ActionPayload): LegalAction[] {
  const legal = getLegalActions(room.state, playerId)
  const match = legal.find((a) => a.id === action.actionId)
  if (!match) throw new Error(`Invalid action: ${action.actionId}`)

  room.state.eventLog.push({
    id: crypto.randomUUID(),
    turn: room.state.turnNumber,
    phase: room.state.phase,
    type: match.type,
    message: `${playerId} executed ${match.description}`,
    timestamp: Date.now(),
  })
  return legal
}

export function registerHttpRoutes(app: FastifyInstance): void {
  app.get('/health', async () => ({ ok: true, service: '@galaxy/server' }))

  app.post<{ Body: { map: MapDefinition; maxPlayers?: number } }>('/rooms', async (req) => {
    const room = createRoom(req.body.map, req.body.maxPlayers ?? 6)
    return { roomId: room.id, code: room.code }
  })

  app.post<{ Params: { id: string }; Body: { playerName: string } }>(
    '/rooms/:id/join',
    async (req, reply) => {
      const result = joinRoom(req.params.id, req.body.playerName)
      if (!result) return reply.status(400).send({ error: 'Cannot join room' })
      return { playerId: result.playerId, code: result.room.code }
    },
  )

  app.get<{ Params: { id: string }; Querystring: { playerId: string } }>(
    '/rooms/:id/state',
    async (req, reply) => {
      const room = getRoom(req.params.id)
      if (!room) return reply.status(404).send({ error: 'Room not found' })
      return getObservation(room, req.query.playerId)
    },
  )

  app.get<{ Params: { id: string }; Querystring: { playerId: string } }>(
    '/rooms/:id/legal-actions',
    async (req, reply) => {
      const room = getRoom(req.params.id)
      if (!room) return reply.status(404).send({ error: 'Room not found' })
      return getLegalActions(room.state, req.query.playerId)
    },
  )

  app.post<{ Params: { id: string }; Body: { playerId: string; action: ActionPayload } }>(
    '/rooms/:id/action',
    async (req, reply) => {
      const room = getRoom(req.params.id)
      if (!room) return reply.status(404).send({ error: 'Room not found' })
      try {
        submitAction(room, req.body.playerId, req.body.action)
        return getObservation(room, req.body.playerId)
      } catch (e) {
        return reply.status(400).send({ error: String(e) })
      }
    },
  )

  app.get<{ Params: { id: string } }>('/rooms/:id/events', async (req, reply) => {
    const room = getRoom(req.params.id)
    if (!room) return reply.status(404).send({ error: 'Room not found' })
    return room.state.eventLog.slice(-20)
  })
}
