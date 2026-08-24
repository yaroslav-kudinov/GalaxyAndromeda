#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const GAME_SERVER_URL = process.env.GAME_SERVER_URL ?? 'http://127.0.0.1:3001'

interface MapDefinition {
  id: string
  name: string
  cells: { q: number; r: number }[]
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GAME_SERVER_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

const tools = [
  { name: 'game_ping', description: 'Check game server health' },
  { name: 'game_create_room', description: 'Create room; optional map JSON body' },
  { name: 'game_join_room', description: 'Join lobby: roomId, playerName, optional preferredPlayerId' },
  { name: 'game_start_room', description: 'Host starts the match from lobby: roomId, playerId' },
  { name: 'game_get_state', description: 'Get observation: roomId, playerId' },
  { name: 'game_get_legal_actions', description: 'Legal actions: roomId, playerId' },
  { name: 'game_submit_action', description: 'Submit: roomId, playerId, actionId' },
  { name: 'game_get_event_log', description: 'Recent events: roomId' },
  { name: 'game_add_ai_player', description: 'Add AI slot: roomId, name?' },
]

const server = new Server(
  { name: 'galaxy-andromeda-game', version: '0.0.1' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const a = (args ?? {}) as Record<string, string>

  try {
    switch (name) {
      case 'game_ping': {
        const health = await api('/health')
        return { content: [{ type: 'text', text: JSON.stringify(health, null, 2) }] }
      }
      case 'game_create_room': {
        const map = (a.map ? JSON.parse(a.map) : { id: 'new', name: 'New', cells: [{ q: 0, r: 0 }] }) as MapDefinition
        const result = await api('/rooms', {
          method: 'POST',
          body: JSON.stringify({ map, maxPlayers: Number(a.maxPlayers ?? 6) }),
        })
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
      case 'game_join_room': {
        const result = await api(`/rooms/${a.roomId}/join`, {
          method: 'POST',
          body: JSON.stringify({
            playerName: a.playerName ?? 'Agent',
            preferredPlayerId: a.preferredPlayerId || undefined,
          }),
        })
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
      case 'game_start_room': {
        const result = await api(`/rooms/${a.roomId}/start`, {
          method: 'POST',
          body: JSON.stringify({ playerId: a.playerId }),
        })
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
      case 'game_get_state': {
        const obs = await api(
          `/rooms/${a.roomId}/state?playerId=${encodeURIComponent(a.playerId)}`,
        )
        return { content: [{ type: 'text', text: JSON.stringify(obs, null, 2) }] }
      }
      case 'game_get_legal_actions': {
        const actions = await api(
          `/rooms/${a.roomId}/legal-actions?playerId=${encodeURIComponent(a.playerId)}`,
        )
        return { content: [{ type: 'text', text: JSON.stringify(actions, null, 2) }] }
      }
      case 'game_submit_action': {
        const obs = await api(`/rooms/${a.roomId}/action`, {
          method: 'POST',
          body: JSON.stringify({
            playerId: a.playerId,
            action: { actionId: a.actionId, params: a.params ? JSON.parse(a.params) : undefined },
          }),
        })
        return { content: [{ type: 'text', text: JSON.stringify(obs, null, 2) }] }
      }
      case 'game_get_event_log': {
        const events = await api(`/rooms/${a.roomId}/events`)
        return { content: [{ type: 'text', text: JSON.stringify(events, null, 2) }] }
      }
      case 'game_add_ai_player': {
        const result = await api(`/rooms/${a.roomId}/join`, {
          method: 'POST',
          body: JSON.stringify({ playerName: a.name ?? 'AI Agent' }),
        })
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
  } catch (e) {
    return { content: [{ type: 'text', text: String(e) }], isError: true }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
