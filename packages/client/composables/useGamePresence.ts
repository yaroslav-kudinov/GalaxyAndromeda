import { sendPresence } from '~/composables/useGameApi'

const HEARTBEAT_MS = 8_000

export function useGamePresence(
  roomId: () => string,
  playerId: () => string,
  playerName: () => string,
  enabled: () => boolean,
) {
  let timer: ReturnType<typeof setInterval> | null = null

  async function beat() {
    if (!enabled()) return
    const id = roomId()
    const pid = playerId()
    const name = playerName()
    if (!id || id.startsWith('local-') || !pid || !name) return
    try {
      await sendPresence(id, pid, name)
    } catch {
      /* transient */
    }
  }

  function start() {
    stop()
    if (!import.meta.client) return
    void beat()
    timer = setInterval(beat, HEARTBEAT_MS)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  onUnmounted(stop)

  return { start, stop, beat }
}
