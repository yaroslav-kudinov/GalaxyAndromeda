/**
 * Анимация боя: выстрелы, попадания, взрывы.
 *
 * Системную настройку «уменьшить движение» не слушаем: в Windows её включает режим «наилучшее
 * быстродействие» или отключённые анимации системы, и бой становится неподвижным без ведома
 * игрока. Вместо этого — свой переключатель в окне боя и замер производительности: если кадров
 * меньше 20 в секунду, тяжёлые эффекты (летящие выстрелы, осколки) отключаются, вспышки остаются.
 */
const STORAGE_KEY = 'galaxy-battle-motion'
/** Медиана кадра дольше 50 мс — меньше 20 кадров в секунду. */
const SLOW_FRAME_MS = 50
const PROBE_FRAMES = 40

const enabled = ref(true)
/** Машина не тянет тяжёлые эффекты — выясняется замером один раз за сессию. */
const lowPerformance = ref(false)
let hydrated = false
let probed = false

function hydrate() {
  if (hydrated || !import.meta.client) return
  hydrated = true
  try {
    enabled.value = localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    enabled.value = true
  }
}

/** Замер частоты кадров, пока окно боя открыто и ещё ничего не летит. */
function probePerformance() {
  if (probed || !import.meta.client || typeof requestAnimationFrame !== 'function') return
  probed = true
  const frames: number[] = []
  let last = performance.now()
  const tick = (now: number) => {
    frames.push(now - last)
    last = now
    if (frames.length < PROBE_FRAMES) {
      requestAnimationFrame(tick)
      return
    }
    // Первые кадры — открытие окна, они всегда медленнее: не учитываем.
    const sorted = frames.slice(5).sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0
    lowPerformance.value = median > SLOW_FRAME_MS
  }
  requestAnimationFrame(tick)
}

export function useBattleMotion() {
  hydrate()
  return {
    /** Анимация боя включена игроком. */
    enabled: readonly(enabled),
    /** Летящие выстрелы и осколки: включено и машина тянет. */
    rich: computed(() => enabled.value && !lowPerformance.value),
    lowPerformance: readonly(lowPerformance),
    probePerformance,
    toggle() {
      enabled.value = !enabled.value
      try {
        localStorage.setItem(STORAGE_KEY, enabled.value ? 'on' : 'off')
      } catch {
        /* приватный режим — переключатель действует до перезагрузки */
      }
    },
  }
}
