import {
  fetchRoomChat,
  postRoomChat,
  type RoomChatMessage,
} from '~/composables/useGameApi'

const POLL_MS = 1800

export function useRoomChat(options: {
  roomId: Ref<string>
  playerId: Ref<string | null>
  enabled: Ref<boolean>
}) {
  const messages = ref<RoomChatMessage[]>([])
  const sending = ref(false)
  const error = ref<string | null>(null)
  const open = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null
  let lastId: string | null = null

  async function poll() {
    const roomId = options.roomId.value
    const playerId = options.playerId.value
    if (!options.enabled.value || !playerId || roomId.startsWith('local-')) return
    try {
      const res = await fetchRoomChat(roomId, playerId, lastId)
      if (res.messages.length) {
        const known = new Set(messages.value.map((m) => m.id))
        const fresh = res.messages.filter((m) => !known.has(m.id))
        if (fresh.length) {
          messages.value = [...messages.value, ...fresh].slice(-200)
          lastId = messages.value[messages.value.length - 1]?.id ?? lastId
        }
      }
    } catch {
      /* сеть — следующий тик */
    }
  }

  async function send(text: string, toPlayerId: string | null) {
    const roomId = options.roomId.value
    const playerId = options.playerId.value
    if (!playerId || roomId.startsWith('local-')) return
    sending.value = true
    error.value = null
    try {
      const { message } = await postRoomChat(roomId, playerId, text, toPlayerId)
      if (!messages.value.some((m) => m.id === message.id)) {
        messages.value = [...messages.value, message].slice(-200)
      }
      lastId = message.id
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось отправить'
    } finally {
      sending.value = false
    }
  }

  function start() {
    stop()
    void poll()
    timer = setInterval(() => {
      void poll()
    }, POLL_MS)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function reset() {
    messages.value = []
    lastId = null
    error.value = null
  }

  watch(
    [() => options.enabled.value, () => options.playerId.value, () => options.roomId.value],
    ([enabled]) => {
      reset()
      if (enabled && options.playerId.value && !options.roomId.value.startsWith('local-')) {
        start()
      } else {
        stop()
      }
    },
    { immediate: true },
  )

  onUnmounted(stop)

  return {
    messages,
    sending,
    error,
    open,
    send,
    poll,
  }
}
