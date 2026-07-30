/** Идентификатор слота лобби: player-1 … player-N */
export function playerIdFromSlot(slot: number): string {
  return `player-${slot}`
}

export function slotFromPlayerId(playerId: string): number | null {
  const m = /^player-(\d+)$/.exec(playerId)
  if (!m) return null
  const n = Number.parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

export function listLobbyPlayerIds(maxPlayers: number): string[] {
  const n = Math.max(0, Math.floor(maxPlayers))
  return Array.from({ length: n }, (_, i) => playerIdFromSlot(i + 1))
}

export function freeLobbyPlayerIds(joinedPlayerIds: string[], maxPlayers: number): string[] {
  return listLobbyPlayerIds(maxPlayers).filter((id) => !joinedPlayerIds.includes(id))
}

export function firstFreeLobbyPlayerId(joinedPlayerIds: string[], maxPlayers: number): string | null {
  return freeLobbyPlayerIds(joinedPlayerIds, maxPlayers)[0] ?? null
}

export type JoinSlotResult =
  | { ok: true; playerId: string; previousPlayerId?: string }
  | { ok: false; error: string; availablePlayerIds: string[] }

function roomFullError(joinedPlayerIds: string[], maxPlayers: number): JoinSlotResult {
  return {
    ok: false,
    error: 'Комната заполнена',
    availablePlayerIds: freeLobbyPlayerIds(joinedPlayerIds, maxPlayers),
  }
}

/** Выбор слота при первом входе или повторном подключении без записи в joinedPlayerIds */
export function resolveJoinPlayerId(
  joinedPlayerIds: string[],
  maxPlayers: number,
  preferredPlayerId?: string,
): JoinSlotResult {
  if (joinedPlayerIds.length >= maxPlayers) {
    return roomFullError(joinedPlayerIds, maxPlayers)
  }

  const available = freeLobbyPlayerIds(joinedPlayerIds, maxPlayers)

  if (preferredPlayerId) {
    const slot = slotFromPlayerId(preferredPlayerId)
    if (slot === null || slot < 1 || slot > maxPlayers) {
      return {
        ok: false,
        error: `Недопустимый слот: ${preferredPlayerId}`,
        availablePlayerIds: available,
      }
    }
    if (joinedPlayerIds.includes(preferredPlayerId)) {
      return {
        ok: false,
        error: `Слот ${preferredPlayerId} занят`,
        availablePlayerIds: available,
      }
    }
    return { ok: true, playerId: preferredPlayerId }
  }

  const first = firstFreeLobbyPlayerId(joinedPlayerIds, maxPlayers)
  if (!first) return roomFullError(joinedPlayerIds, maxPlayers)
  return { ok: true, playerId: first }
}

/** Повторный вход: тот же слот, смена на свободный или вход после освобождения слота */
export function resolveRejoinPlayerId(
  currentPlayerId: string,
  joinedPlayerIds: string[],
  maxPlayers: number,
  preferredPlayerId?: string,
): JoinSlotResult {
  const targetId = preferredPlayerId ?? currentPlayerId
  const inRoom = joinedPlayerIds.includes(currentPlayerId)

  if (inRoom && targetId === currentPlayerId) {
    return { ok: true, playerId: currentPlayerId }
  }

  if (inRoom && targetId !== currentPlayerId) {
    const slot = slotFromPlayerId(targetId)
    if (slot === null || slot < 1 || slot > maxPlayers) {
      return {
        ok: false,
        error: `Недопустимый слот: ${targetId}`,
        availablePlayerIds: freeLobbyPlayerIds(
          joinedPlayerIds.filter((id) => id !== currentPlayerId),
          maxPlayers,
        ),
      }
    }
    if (joinedPlayerIds.includes(targetId)) {
      return {
        ok: false,
        error: `Слот ${targetId} занят`,
        availablePlayerIds: freeLobbyPlayerIds(
          joinedPlayerIds.filter((id) => id !== currentPlayerId),
          maxPlayers,
        ),
      }
    }
    return { ok: true, playerId: targetId, previousPlayerId: currentPlayerId }
  }

  return resolveJoinPlayerId(joinedPlayerIds, maxPlayers, targetId)
}

/** Слот по умолчанию: claim → session → первый свободный */
export function defaultPreferredPlayerId(
  joinedPlayerIds: string[],
  maxPlayers: number,
  options?: { claimPlayerId?: string | null; sessionPlayerId?: string | null },
): string | null {
  const available = freeLobbyPlayerIds(joinedPlayerIds, maxPlayers)
  if (!available.length) return null

  for (const id of [options?.claimPlayerId, options?.sessionPlayerId]) {
    if (id && available.includes(id)) return id
  }

  return firstFreeLobbyPlayerId(joinedPlayerIds, maxPlayers)
}
