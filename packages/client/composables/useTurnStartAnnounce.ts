/**
 * Объявление начала хода: каждый новый ход — окно «Ход N» с тем, что произошло в его начале
 * (тик осад, захваты, выбывания, доктрины, ваша перезарядка) и что делать дальше.
 *
 * Игроки пропускали свою очередь планирования, не заметив, что ход сменился. Показанный ход
 * запоминается по комнате в браузере, поэтому после перезагрузки страницы окно не повторяется.
 */
const STORAGE_PREFIX = 'galaxy-turn-seen-'

function readSeen(roomId: string): number {
  try {
    return Number(localStorage.getItem(STORAGE_PREFIX + roomId) ?? 0) || 0
  } catch {
    return 0
  }
}

function writeSeen(roomId: string, turn: number): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + roomId, String(turn))
  } catch {
    /* приватный режим — окно может показаться ещё раз после перезагрузки */
  }
}

export function useTurnStartAnnounce(roomId: Ref<string>, turnNumber: Ref<number>, ready: Ref<boolean>) {
  const visible = ref(false)
  const shownTurn = ref(0)

  watch(
    [roomId, turnNumber, ready],
    () => {
      if (!import.meta.client || !ready.value) return
      const id = roomId.value
      const turn = turnNumber.value
      if (!id || turn < 1) return
      if (turn <= readSeen(id)) return
      writeSeen(id, turn)
      shownTurn.value = turn
      visible.value = true
    },
    { immediate: true },
  )

  return {
    visible: readonly(visible),
    shownTurn: readonly(shownTurn),
    dismiss() {
      visible.value = false
    },
  }
}
