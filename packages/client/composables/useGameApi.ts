import type { GameObservation, MapDefinition } from '@galaxy/rules'

const API_BASE = '/api'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export interface RoomCreated {
  roomId: string
  code: string
}

export interface RoomBootstrap {
  roomId: string
  code: string
  map: MapDefinition
  maxPlayers: number
  playerCount: number
}

export interface JoinResult {
  playerId: string
  code: string
}

export async function checkServerHealth(): Promise<boolean> {
  try {
    await apiFetch<{ ok: boolean }>('/health')
    return true
  } catch {
    return false
  }
}

export async function createRoom(map: MapDefinition, maxPlayers = 6): Promise<RoomCreated> {
  return apiFetch<RoomCreated>('/rooms', {
    method: 'POST',
    body: JSON.stringify({ map, maxPlayers }),
  })
}

export async function joinRoom(roomId: string, playerName: string): Promise<JoinResult> {
  return apiFetch<JoinResult>(`/rooms/${roomId}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerName }),
  })
}

export async function fetchRoomBootstrap(roomId: string): Promise<RoomBootstrap> {
  return apiFetch<RoomBootstrap>(`/rooms/${roomId}/bootstrap`)
}

/** Human UI: skip heavy ASCII/spatial geometry (agents use full observation via MCP). */
export async function fetchObservation(roomId: string, playerId: string): Promise<GameObservation> {
  const qs = new URLSearchParams({ playerId, geometry: '0' })
  return apiFetch<GameObservation>(`/rooms/${roomId}/state?${qs}`)
}

export async function submitGameAction(
  roomId: string,
  playerId: string,
  actionId: string,
  params?: Record<string, unknown>,
): Promise<GameObservation> {
  return apiFetch<GameObservation>(`/rooms/${roomId}/action?geometry=0`, {
    method: 'POST',
    body: JSON.stringify({ playerId, action: { actionId, params } }),
  })
}
