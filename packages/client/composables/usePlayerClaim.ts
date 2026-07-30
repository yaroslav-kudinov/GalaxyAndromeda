const CLAIMS_KEY = 'galaxy-lobby-claims'

export interface LobbyPlayerClaim {
  roomId: string
  playerId: string
  playerName: string
  updatedAt: number
}

export function loadAllPlayerClaims(): Record<string, LobbyPlayerClaim> {
  if (!import.meta.client) return {}
  try {
    const raw = localStorage.getItem(CLAIMS_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, LobbyPlayerClaim>
  } catch {
    return {}
  }
}

export function loadPlayerClaim(roomId: string): LobbyPlayerClaim | null {
  return loadAllPlayerClaims()[roomId] ?? null
}

export function savePlayerClaim(claim: Omit<LobbyPlayerClaim, 'updatedAt'>): void {
  if (!import.meta.client) return
  const all = loadAllPlayerClaims()
  all[claim.roomId] = { ...claim, updatedAt: Date.now() }
  localStorage.setItem(CLAIMS_KEY, JSON.stringify(all))
}

export function removePlayerClaim(roomId: string): void {
  if (!import.meta.client) return
  const all = loadAllPlayerClaims()
  delete all[roomId]
  localStorage.setItem(CLAIMS_KEY, JSON.stringify(all))
}
