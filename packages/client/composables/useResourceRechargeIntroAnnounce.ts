const STORAGE_PREFIX = 'galaxy-recharge-intro-seen:'

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

/**
 * Одноразовое объявление счётчика перезарядки в начале партии (ход 1, без карты события).
 * Если одновременно открыта модалка события — не показываем (счётчик уже на ней).
 */
export function useResourceRechargeIntroAnnounce(
  roomId: Ref<string>,
  turnNumber: Ref<number>,
  rechargeBanner: Ref<string | null>,
  eventAnnounceVisible: Ref<boolean>,
) {
  const visible = ref(false)
  let watchingRoomId: string | null = null

  function storageKeyFor(id: string): string {
    return `${STORAGE_PREFIX}${id}`
  }

  function markSeen(id: string): void {
    writeStorage(storageKeyFor(id), '1')
  }

  function dismiss(): void {
    const id = roomId.value
    if (id) markSeen(id)
    visible.value = false
  }

  watch(
    [roomId, turnNumber, rechargeBanner, eventAnnounceVisible],
    () => {
      if (!import.meta.client) return
      const id = roomId.value
      if (!id) return

      if (watchingRoomId !== id) {
        watchingRoomId = id
        if (turnNumber.value > 1) markSeen(id)
        visible.value = false
        return
      }

      if (turnNumber.value > 1) {
        markSeen(id)
        visible.value = false
        return
      }

      if (eventAnnounceVisible.value) {
        markSeen(id)
        visible.value = false
        return
      }

      if (!rechargeBanner.value) {
        visible.value = false
        return
      }

      if (readStorage(storageKeyFor(id)) === '1') {
        visible.value = false
        return
      }

      visible.value = true
    },
    { immediate: true, flush: 'post' },
  )

  return { visible, dismiss }
}
