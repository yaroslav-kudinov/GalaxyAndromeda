import { defaultPreferredPlayerId } from '@galaxy/rules'
import type { RoomBootstrap } from '~/composables/useGameApi'
import { loadPlayerClaim } from '~/composables/usePlayerClaim'
import { loadGameSessionForRoom } from '~/composables/useGameSession'

export function bootstrapToLobbySlots(bootstrap: RoomBootstrap) {
  return bootstrap.players.slice(0, bootstrap.maxPlayers).map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    joined: p.joined ?? bootstrap.joinedPlayerIds.includes(p.id),
  }))
}

export function defaultSlotForRoom(roomId: string, bootstrap: RoomBootstrap): string | null {
  const claim = loadPlayerClaim(roomId)
  const session = loadGameSessionForRoom(roomId)
  return defaultPreferredPlayerId(bootstrap.joinedPlayerIds, bootstrap.maxPlayers, {
    claimPlayerId: claim?.playerId,
    sessionPlayerId: session?.playerId,
  })
}

export function roomHasFreeSlot(bootstrap: Pick<RoomBootstrap, 'joinedPlayerIds' | 'maxPlayers'>): boolean {
  return bootstrap.joinedPlayerIds.length < bootstrap.maxPlayers
}
