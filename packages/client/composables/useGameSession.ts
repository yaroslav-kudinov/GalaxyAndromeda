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
