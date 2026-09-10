/**
 * In-memory room chat (public + 1-to-1). Cleared with the room.
 * Not persisted to disk — intentional for lobby/match chatter.
 */

export const CHAT_MAX_TEXT_LENGTH = 400
export const CHAT_MAX_HISTORY = 200
/** Soft rate: messages per window per player */
export const CHAT_RATE_LIMIT = 12
export const CHAT_RATE_WINDOW_MS = 60_000

export type RoomChatMessage = {
  id: string
  at: number
  fromPlayerId: string
  fromName: string
  /** null → общий канал комнаты */
  toPlayerId: string | null
  text: string
}

type RateBucket = { timestamps: number[] }

const chatByRoom = new Map<string, RoomChatMessage[]>()
const rateByRoomPlayer = new Map<string, RateBucket>()

let seq = 0

function nextId(): string {
  seq += 1
  return `c${Date.now().toString(36)}-${seq}`
}

function rateKey(roomId: string, playerId: string): string {
  return `${roomId}\0${playerId}`
}

/** Strip control chars; trim; clamp length. Empty → null. */
export function sanitizeChatText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // eslint-disable-next-line no-control-regex -- strip C0 controls except \n\t (then drop those too for chat)
  const cleaned = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
  if (!cleaned) return null
  return cleaned.slice(0, CHAT_MAX_TEXT_LENGTH)
}

export function clearRoomChat(roomId: string): void {
  chatByRoom.delete(roomId)
  for (const key of [...rateByRoomPlayer.keys()]) {
    if (key.startsWith(`${roomId}\0`)) rateByRoomPlayer.delete(key)
  }
}

function allowSend(roomId: string, playerId: string, now: number): boolean {
  const key = rateKey(roomId, playerId)
  let bucket = rateByRoomPlayer.get(key)
  if (!bucket) {
    bucket = { timestamps: [] }
    rateByRoomPlayer.set(key, bucket)
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < CHAT_RATE_WINDOW_MS)
  if (bucket.timestamps.length >= CHAT_RATE_LIMIT) return false
  bucket.timestamps.push(now)
  return true
}

export type PostChatResult =
  | { ok: true; message: RoomChatMessage }
  | { ok: false; error: string; status: 400 | 403 | 429 }

export function postRoomChat(input: {
  roomId: string
  fromPlayerId: string
  fromName: string
  text: unknown
  toPlayerId?: string | null
  memberIds: ReadonlySet<string> | readonly string[]
  now?: number
}): PostChatResult {
  const now = input.now ?? Date.now()
  const members = input.memberIds instanceof Set ? input.memberIds : new Set(input.memberIds)
  if (!members.has(input.fromPlayerId)) {
    return { ok: false, error: 'Игрок не в комнате', status: 403 }
  }
  const text = sanitizeChatText(input.text)
  if (!text) {
    return { ok: false, error: 'Пустое сообщение', status: 400 }
  }
  const toPlayerId =
    input.toPlayerId == null || input.toPlayerId === ''
      ? null
      : String(input.toPlayerId)
  if (toPlayerId) {
    if (toPlayerId === input.fromPlayerId) {
      return { ok: false, error: 'Нельзя писать себе', status: 400 }
    }
    if (!members.has(toPlayerId)) {
      return { ok: false, error: 'Получатель не в комнате', status: 400 }
    }
  }
  if (!allowSend(input.roomId, input.fromPlayerId, now)) {
    return { ok: false, error: 'Слишком много сообщений — подождите', status: 429 }
  }

  const message: RoomChatMessage = {
    id: nextId(),
    at: now,
    fromPlayerId: input.fromPlayerId,
    fromName: input.fromName.slice(0, 48) || input.fromPlayerId,
    toPlayerId,
    text,
  }
  let list = chatByRoom.get(input.roomId)
  if (!list) {
    list = []
    chatByRoom.set(input.roomId, list)
  }
  list.push(message)
  if (list.length > CHAT_MAX_HISTORY) {
    list.splice(0, list.length - CHAT_MAX_HISTORY)
  }
  return { ok: true, message }
}

export function listRoomChatVisible(input: {
  roomId: string
  viewerPlayerId: string
  afterId?: string | null
  afterAt?: number | null
}): RoomChatMessage[] {
  const list = chatByRoom.get(input.roomId) ?? []
  let start = 0
  if (input.afterId) {
    const idx = list.findIndex((m) => m.id === input.afterId)
    start = idx >= 0 ? idx + 1 : 0
  } else if (input.afterAt != null && Number.isFinite(input.afterAt)) {
    start = list.findIndex((m) => m.at > (input.afterAt as number))
    if (start < 0) start = list.length
  }
  return list.slice(start).filter((m) => {
    if (m.toPlayerId == null) return true
    return m.fromPlayerId === input.viewerPlayerId || m.toPlayerId === input.viewerPlayerId
  })
}
