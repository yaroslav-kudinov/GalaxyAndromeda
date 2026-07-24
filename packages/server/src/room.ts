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

} from '@galaxy/rules'



export interface Room {

  id: string

  code: string

  map: MapDefinition

  state: GameSnapshot

  playerIds: string[]

  maxPlayers: number

}



const rooms = new Map<string, Room>()



function randomCode(): string {

  return Math.random().toString(36).slice(2, 8).toUpperCase()

}



function wantsFullGeometry(raw: string | undefined): boolean {

  return raw === '1' || raw === 'true'

}



function roomObservation(room: Room, playerId: string, includeGeometry: boolean): GameObservation {

  const legal = getLegalActionsForSnapshot(room.state, room.map.id, playerId)

  const state = {
    mapId: room.map.id,
    phase: room.state.phase,
    turnNumber: room.state.turnNumber,
    activePlayerId: room.state.activePlayerId,
    players: room.state.players,
    cells: room.state.cells.map(({ actionMarkerId: _a, productionMarkerId: _p, ...cell }) => cell),
    eventLog: room.state.eventLog,
  }

  return buildObservation(state, legal, { geometry: includeGeometry })

}



export function createRoom(map: MapDefinition, maxPlayers = 6): Room {

  const id = crypto.randomUUID()

  const room: Room = {

    id,

    code: randomCode(),

    map,

    state: gameSnapshotFromMap(map),

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



export function getObservation(

  room: Room,

  playerId: string,

  includeGeometry = true,

): GameObservation {

  return roomObservation(room, playerId, includeGeometry)

}



export function submitAction(

  room: Room,

  playerId: string,

  action: ActionPayload,

  includeGeometry = true,

): GameObservation {

  const errors = applyGameActionOnSnapshot(
    room.state,
    room.map,
    playerId,
    action.actionId,
    action.params,
  )

  if (errors.length) throw new Error(errors[0])



  return roomObservation(room, playerId, includeGeometry)

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



  app.get<{ Params: { id: string } }>('/rooms/:id/bootstrap', async (req, reply) => {

    const room = getRoom(req.params.id)

    if (!room) return reply.status(404).send({ error: 'Room not found' })

    return {

      roomId: room.id,

      code: room.code,

      map: room.map,

      maxPlayers: room.maxPlayers,

      playerCount: room.playerIds.length,

    }

  })



  app.get<{ Params: { id: string }; Querystring: { playerId: string; geometry?: string } }>(

    '/rooms/:id/state',

    async (req, reply) => {

      const room = getRoom(req.params.id)

      if (!room) return reply.status(404).send({ error: 'Room not found' })

      const includeGeometry = wantsFullGeometry(req.query.geometry)

      return getObservation(room, req.query.playerId, includeGeometry)

    },

  )



  app.get<{ Params: { id: string }; Querystring: { playerId: string } }>(

    '/rooms/:id/legal-actions',

    async (req, reply) => {

      const room = getRoom(req.params.id)

      if (!room) return reply.status(404).send({ error: 'Room not found' })

      return getLegalActionsForSnapshot(room.state, room.map.id, req.query.playerId)

    },

  )



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

        return submitAction(room, req.body.playerId, req.body.action, includeGeometry)

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


