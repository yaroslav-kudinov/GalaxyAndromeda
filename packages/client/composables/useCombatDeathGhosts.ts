import type { CombatGhostView } from '~/utils/combat-map-fx'

export const COMBAT_DEATH_GHOST_MS = 1200

/**
 * Короткий показ призраков погибших. Новый observationRevision с другим набором id
 * сразу сменяет картинку. Не держит корабли на исходной клетке и не спорит с pendingCombat.
 */
export function useCombatDeathGhosts(options: {
  ghosts: () => CombatGhostView[]
  playKey: () => string | null
  observationRevision: () => unknown
  combatStillPending: () => boolean
}) {
  const visibleGhosts = ref<CombatGhostView[]>([])
  const burstKey = ref<string | null>(null)
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  function clearHideTimer() {
    if (!hideTimer) return
    clearTimeout(hideTimer)
    hideTimer = null
  }

  function publish(list: CombatGhostView[], key: string | null) {
    visibleGhosts.value = key
      ? list.map((ghost) => ({ ...ghost, id: `${key}:${ghost.id}` }))
      : []
    burstKey.value = key
    clearHideTimer()
    if (!list.length) return
    if (options.combatStillPending()) return
    hideTimer = setTimeout(() => {
      hideTimer = null
      visibleGhosts.value = []
    }, COMBAT_DEATH_GHOST_MS)
  }

  watch(
    () => [options.playKey(), options.observationRevision()] as const,
    ([key]) => {
      const list = options.ghosts()
      if (!list.length || !key) {
        publish([], null)
        return
      }
      publish(list, key)
    },
    { immediate: true },
  )

  watch(
    () => options.combatStillPending(),
    (pending) => {
      if (pending) {
        clearHideTimer()
        return
      }
      if (!visibleGhosts.value.length) return
      clearHideTimer()
      hideTimer = setTimeout(() => {
        hideTimer = null
        visibleGhosts.value = []
      }, COMBAT_DEATH_GHOST_MS)
    },
  )

  onUnmounted(() => {
    clearHideTimer()
  })

  return {
    visibleGhosts,
    burstKey,
  }
}
