import type { GameObservation, GalaxySaveFile, MapDefinition } from '@galaxy/rules'
import { debugLog } from './useDebugLog'

const API_BASE = '/api'

export class GameApiError extends Error {
  availablePlayerIds?: string[]
  status: number

  constructor(message: string, status: number, availablePlayerIds?: string[]) {
    super(message)
    this.name = 'GameApiError'
    this.status = status
    this.availablePlayerIds = availablePlayerIds
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { body, headers, method: requestedMethod, ...requestInit } = init ?? {}
  // Тело запроса всегда означает мутацию: не позволяем случайному GET потерять action payload.
  const method = body != null ? 'POST' : requestedMethod ?? 'GET'
  const startedAt = performance.now()
  debugLog('api.request', { method, path })
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...requestInit,
      body,
      method,
      // 301/302/303 могут превратить POST в GET; пусть ошибка прокси останется видимой.
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...headers },
    })
  } catch (error) {
    debugLog('api.network-error', {
      method,
      path,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as {
      error?: string
      message?: string
      availablePlayerIds?: string[]
    }
    debugLog('api.error', {
      method,
      path,
      status: res.status,
      durationMs: Math.round(performance.now() - startedAt),
      error: body.message ?? body.error,
    })
    throw new GameApiError(
      body.message ?? body.error ?? `HTTP ${res.status}`,
      res.status,
      body.availablePlayerIds,
    )
  }
  const response = await res.json() as T
  const observation = response as Partial<GameObservation>
  const observationRevision = (observation.mechanics as unknown as { observationRevision?: number } | undefined)
    ?.observationRevision
  debugLog('api.response', {
    method,
    path,
    status: res.status,
    durationMs: Math.round(performance.now() - startedAt),
    observationRevision,
  })
  return response
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
  status?: 'lobby' | 'playing'
  hostPlayerId?: string | null
  joinedPlayerIds: string[]
  availablePlayerIds?: string[]
  players: { id: string; name: string; color: string; joined?: boolean }[]
}

export interface JoinResult {
  playerId: string
  code: string
}

export interface LobbyPlayerEntry {
  id: string
  name: string
  color: string
  joined: boolean
  active: boolean
}

export interface LobbyListEntry {
  roomId: string
  code: string
  mapId: string
  mapName: string
  maxPlayers: number
  playerCount: number
  status?: 'lobby' | 'playing'
  hostPlayerId?: string | null
  phase: string
  turnNumber: number
  activePlayerId: string
  players: LobbyPlayerEntry[]
}

export interface LobbiesResponse {
  lobbies: LobbyListEntry[]
  presenceTtlMs: number
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

export async function createRoomFromSave(save: GalaxySaveFile, maxPlayers = 6): Promise<RoomCreated> {
  return apiFetch<RoomCreated>('/rooms', {
    method: 'POST',
    body: JSON.stringify({ save, maxPlayers }),
  })
}

export async function joinRoom(
  roomId: string,
  playerName: string,
  preferredPlayerId?: string,
): Promise<JoinResult> {
  return apiFetch<JoinResult>(`/rooms/${roomId}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerName, preferredPlayerId }),
  })
}

export async function rejoinRoom(
  roomId: string,
  playerId: string,
  playerName?: string,
  preferredPlayerId?: string,
): Promise<JoinResult> {
  return apiFetch<JoinResult>(`/rooms/${roomId}/rejoin`, {
    method: 'POST',
    body: JSON.stringify({ playerId, playerName, preferredPlayerId }),
  })
}

export async function sendPresence(
  roomId: string,
  playerId: string,
  playerName: string,
): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/rooms/${roomId}/presence`, {
    method: 'POST',
    body: JSON.stringify({ playerId, playerName }),
  })
}

export async function fetchLobbies(): Promise<LobbiesResponse> {
  return apiFetch<LobbiesResponse>('/lobbies')
}

export async function fetchRoomBootstrap(roomId: string): Promise<RoomBootstrap> {
  return apiFetch<RoomBootstrap>(`/rooms/${roomId}/bootstrap`)
}

export async function startRoom(roomId: string, playerId: string): Promise<{ ok: true; code: string; status: string }> {
  return apiFetch(`/rooms/${roomId}/start`, {
    method: 'POST',
    body: JSON.stringify({ playerId }),
  })
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

export async function updateCombatPrepAction(
  roomId: string,
  playerId: string,
  ready: boolean,
  prioritySkips?: { shipType: import('@galaxy/rules').ShipType }[],
): Promise<GameObservation> {
  return submitGameAction(roomId, playerId, 'update-combat-prep', { ready, prioritySkips })
}

export interface BugReportSubmitResult {
  ok: boolean
  id: string
  expiresAt: string
  hasScreenshot: boolean
}

export async function submitBugReport(payload: {
  description: string
  screenshotBase64?: string
  screenshotMime?: string
  roomId?: string
  playerId?: string
  playerName?: string
}): Promise<BugReportSubmitResult> {
  return apiFetch<BugReportSubmitResult>('/bug-reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
