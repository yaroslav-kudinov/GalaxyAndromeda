import type { GalaxySaveFile } from '@galaxy/rules'
import { serializeGalaxySave } from '@galaxy/rules'

const SESSION_KEY = 'galaxy-game-session'

export interface GameSession {
  roomId: string
  playerId: string
  playerName: string
  code?: string
}

export function loadGameSession(): GameSession | null {
  if (!import.meta.client) return null
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as GameSession
  } catch {
    return null
  }
}

/** Session only if it belongs to the given room */
export function loadGameSessionForRoom(roomId: string): GameSession | null {
  const session = loadGameSession()
  if (!session || session.roomId !== roomId) return null
  return session
}

export function saveGameSession(session: GameSession): void {
  if (!import.meta.client) return
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearGameSession(): void {
  if (!import.meta.client) return
  sessionStorage.removeItem(SESSION_KEY)
}

export function gameSaveStorageKey(roomId: string): string {
  return `galaxy-game-${roomId}`
}

/** Локальное хранение сейва — только для offline-комнат (`local-*`). */
export function shouldPersistLocalGalaxySave(roomId: string): boolean {
  return roomId.startsWith('local-')
}

export function loadLocalGalaxySaveRaw(roomId: string): string | null {
  if (!import.meta.client || !shouldPersistLocalGalaxySave(roomId)) return null
  try {
    return localStorage.getItem(gameSaveStorageKey(roomId))
  } catch {
    return null
  }
}

export function persistLocalGalaxySave(roomId: string, save: GalaxySaveFile): boolean {
  if (!import.meta.client || !shouldPersistLocalGalaxySave(roomId)) return false
  try {
    localStorage.setItem(gameSaveStorageKey(roomId), serializeGalaxySave(save, false))
    return true
  } catch (error) {
    if (isStorageQuotaError(error)) {
      console.warn('@galaxy/client: local save quota exceeded', roomId)
      return false
    }
    throw error
  }
}

export function clearLocalGalaxySave(roomId: string): void {
  if (!import.meta.client) return
  try {
    localStorage.removeItem(gameSaveStorageKey(roomId))
  } catch {
    /* ignore */
  }
}

/** Удаляет устаревшие кэши онлайн-комнат — освобождает квоту после старых версий клиента. */
export function pruneOnlineGalaxySaveCache(activeRoomId?: string): void {
  if (!import.meta.client) return
  const prefix = 'galaxy-game-'
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      const roomId = key.slice(prefix.length)
      if (roomId.startsWith('local-')) continue
      if (activeRoomId && roomId === activeRoomId) continue
      localStorage.removeItem(key)
    }
  } catch {
    /* ignore */
  }
}

function isStorageQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
}
