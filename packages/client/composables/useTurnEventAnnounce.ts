import type { ActiveEventObservation } from '@galaxy/rules'

const STORAGE_PREFIX = 'galaxy-turn-event-seen:'

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* quota / private mode */
  }
}

function eventKey(turnNumber: number, eventId: string): string {
  return `${turnNumber}:${eventId}`
}

/**
 * Модалка-объявление новой карты события.
 * Первый снимок комнаты (вход посреди хода) не показываем.
 * Повторный poll/HMR того же хода — localStorage по turnNumber+eventId.
 */
export function useTurnEventAnnounce(
  roomId: Ref<string>,
  event: Ref<ActiveEventObservation | null>,
  turnNumber: Ref<number>,
) {
  const visible = ref(false)
  const announced = ref<ActiveEventObservation | null>(null)
  const announcedTurn = ref(0)
  let watchingRoomId: string | null = null

  function storageKeyFor(id: string): string {
    return `${STORAGE_PREFIX}${id}`
  }

  function currentKey(): string | null {
    const ev = event.value
    if (!ev?.resolved || !ev.id) return null
    return eventKey(turnNumber.value, ev.id)
  }

  function markSeen(id: string, key: string): void {
    writeStorage(storageKeyFor(id), key)
  }

  function dismiss(): void {
    const id = roomId.value
    const key = currentKey()
    if (id && key) markSeen(id, key)
    visible.value = false
  }

  watch(
    [roomId, event, turnNumber],
    () => {
      if (!import.meta.client) return
      const id = roomId.value
      if (!id) return

      if (watchingRoomId !== id) {
        watchingRoomId = id
        const joinKey = currentKey()
        if (joinKey) markSeen(id, joinKey)
        visible.value = false
        return
      }

      const ev = event.value
      const key = currentKey()
      if (!ev || !key) return

      const stored = readStorage(storageKeyFor(id))
      if (stored === key) {
        visible.value = false
        return
      }

      announced.value = ev
      announcedTurn.value = turnNumber.value
      visible.value = true
    },
    { immediate: true, flush: 'post' },
  )

  return { visible, announced, announcedTurn, dismiss }
}
