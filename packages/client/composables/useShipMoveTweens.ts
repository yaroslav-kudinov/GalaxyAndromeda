import type { ShipType } from '@galaxy/rules'
import {
  SHIP_MOVE_TWEEN_MS,
  detectHexMoves,
  easeOutCubic,
  indexShipsById,
  shipLocationSignature,
  type BoardCellLike,
} from '~/utils/ship-move-index'

export interface FlyingShipView {
  id: string
  type: ShipType
  player: number
  x: number
  y: number
  scale: number
}

interface Tween {
  id: string
  type: ShipType
  player: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  scale: number
  start: number
  duration: number
}

interface CachedAnchor {
  q: number
  r: number
  x: number
  y: number
  type: ShipType
  player: number
  scale: number
}

export interface UseShipMoveTweensOptions {
  enabled: () => boolean
  cells: () => BoardCellLike[]
  shipAnchor: (q: number, r: number, shipId: string) => { x: number; y: number }
  cellScale: (q: number, r: number) => number
    /** Смена ориентации гексов — сбросить полёт, не интерполировать. */
    layoutEpoch: () => unknown
    /** Новый снимок: снять полёт исчезнувших кораблей, не обнуляя прибытие живых. */
    interruptEpoch?: () => unknown
    durationMs?: number
}

/**
 * Косметический полёт глифа после того, как снимок уже положил корабль на клетку назначения.
 * Не задерживает действия, не читается legal actions, не трогает pendingCombat.
 */
export function useShipMoveTweens(options: UseShipMoveTweensOptions) {
  const duration = options.durationMs ?? SHIP_MOVE_TWEEN_MS
  const flyingShips = ref<FlyingShipView[]>([])
  const tweens = new Map<string, Tween>()
  const lastAnchors = new Map<string, CachedAnchor>()
  let raf = 0

  function stopRaf() {
    if (!raf) return
    cancelAnimationFrame(raf)
    raf = 0
  }

  function collectAnchors(): Map<string, CachedAnchor> {
    const next = new Map<string, CachedAnchor>()
    const indexed = indexShipsById(options.cells())
    for (const [id, ship] of indexed) {
      const pos = options.shipAnchor(ship.q, ship.r, id)
      next.set(id, {
        q: ship.q,
        r: ship.r,
        x: pos.x,
        y: pos.y,
        type: ship.type,
        player: ship.player,
        scale: options.cellScale(ship.q, ship.r),
      })
    }
    return next
  }

  function interpolatedPos(id: string, fallback: { x: number; y: number }): { x: number; y: number } {
    const tw = tweens.get(id)
    if (!tw) return fallback
    const now = performance.now()
    const t = Math.min(1, (now - tw.start) / tw.duration)
    const e = easeOutCubic(t)
    return {
      x: tw.fromX + (tw.toX - tw.fromX) * e,
      y: tw.fromY + (tw.toY - tw.fromY) * e,
    }
  }

  function sampleViews(now: number): FlyingShipView[] {
    const views: FlyingShipView[] = []
    for (const [id, tw] of [...tweens.entries()]) {
      const t = Math.min(1, (now - tw.start) / tw.duration)
      if (t >= 1) {
        tweens.delete(id)
        continue
      }
      const e = easeOutCubic(t)
      views.push({
        id,
        type: tw.type,
        player: tw.player,
        x: tw.fromX + (tw.toX - tw.fromX) * e,
        y: tw.fromY + (tw.toY - tw.fromY) * e,
        scale: tw.scale,
      })
    }
    return views
  }

  function publishFrame() {
    raf = 0
    flyingShips.value = sampleViews(performance.now())
    if (tweens.size) {
      raf = requestAnimationFrame(publishFrame)
    }
  }

  function clearTweens() {
    tweens.clear()
    flyingShips.value = []
    stopRaf()
  }

  function snapToCurrent() {
    clearTweens()
    lastAnchors.clear()
    for (const [id, anchor] of collectAnchors()) {
      lastAnchors.set(id, anchor)
    }
  }

  function onCellsChanged() {
    const next = collectAnchors()
    if (!options.enabled()) {
      clearTweens()
      lastAnchors.clear()
      for (const [id, anchor] of next) lastAnchors.set(id, anchor)
      return
    }

    if (lastAnchors.size === 0) {
      for (const [id, anchor] of next) lastAnchors.set(id, anchor)
      return
    }

    const moved = detectHexMoves(lastAnchors, next)
    const now = performance.now()

    for (const id of moved) {
      const dest = next.get(id)!
      const prev = lastAnchors.get(id)!
      const from = interpolatedPos(id, { x: prev.x, y: prev.y })
      tweens.set(id, {
        id,
        type: dest.type,
        player: dest.player,
        fromX: from.x,
        fromY: from.y,
        toX: dest.x,
        toY: dest.y,
        scale: dest.scale,
        start: now,
        duration,
      })
    }

    for (const [id, tw] of tweens) {
      const dest = next.get(id)
      if (!dest) {
        tweens.delete(id)
        continue
      }
      if (!moved.includes(id)) {
        tw.toX = dest.x
        tw.toY = dest.y
        tw.scale = dest.scale
        tw.type = dest.type
        tw.player = dest.player
      }
    }

    lastAnchors.clear()
    for (const [id, anchor] of next) lastAnchors.set(id, anchor)

    flyingShips.value = sampleViews(performance.now())
    if (tweens.size) {
      if (!raf) raf = requestAnimationFrame(publishFrame)
    } else {
      stopRaf()
    }
  }

  watch(
    () => shipLocationSignature(options.cells()),
    () => onCellsChanged(),
    { flush: 'post' },
  )

  watch(
    () => options.layoutEpoch(),
    () => snapToCurrent(),
  )

  watch(
    () => options.interruptEpoch?.(),
    () => {
      if (options.interruptEpoch == null) return
      const next = collectAnchors()
      for (const [id] of [...tweens]) {
        if (!next.has(id)) tweens.delete(id)
      }
      if (!tweens.size) {
        flyingShips.value = []
        stopRaf()
      }
    },
  )

  onMounted(() => {
    if (lastAnchors.size === 0) snapToCurrent()
  })

  onUnmounted(() => {
    clearTweens()
    lastAnchors.clear()
  })

  const flyingIdSet = computed(() => new Set(flyingShips.value.map((ship) => ship.id)))

  function isFlying(id: string | undefined): boolean {
    return !!id && flyingIdSet.value.has(id)
  }

  return {
    flyingShips,
    flyingIdSet,
    isFlying,
  }
}
