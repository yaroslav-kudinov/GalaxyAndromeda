/**
 * Sparse tilted spiral galaxy that rotates around its centre.
 *
 * Original code for Galaxy Andromeda Tabletop. Dedicated to the public domain
 * under CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/
 *
 * 2D canvas (not a photograph). No third-party textures or video.
 * The home menu no longer mounts this renderer; it uses a static NASA photo.
 */

export type GalaxyHandle = {
  destroy: () => void
}

type GalaxyOptions = {
  canvas: HTMLCanvasElement
  reducedMotion: boolean
}

type Star = {
  r: number
  a: number
  size: number
  alpha: number
  red: number
  green: number
  blue: number
}

type FieldStar = {
  x: number
  y: number
  size: number
  alpha: number
}

/** ~22 seconds per revolution — slow, but the arms visibly crawl. */
const SPIN_RAD_PER_SEC = 0.38
const TILT = 0.4
const ARM_COUNT = 3
const ARM_TWIST = 4.8

function gaussian(): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v)
}

function makeArmStars(count: number): Star[] {
  const stars: Star[] = []
  for (let i = 0; i < count; i++) {
    const arm = i % ARM_COUNT
    const dist = 0.08 + Math.pow(Math.random(), 0.72) * 0.92
    const spread = gaussian() * (0.035 + dist * 0.05)
    const a = (arm / ARM_COUNT) * Math.PI * 2 + dist * ARM_TWIST + spread
    const cool = dist > 0.45
    stars.push({
      r: dist,
      a,
      size: 0.45 + Math.random() * 1.15,
      alpha: 0.1 + Math.random() * 0.22,
      red: cool ? 0.35 + Math.random() * 0.25 : 0.55 + Math.random() * 0.25,
      green: cool ? 0.42 + Math.random() * 0.25 : 0.48 + Math.random() * 0.22,
      blue: cool ? 0.7 + Math.random() * 0.28 : 0.55 + Math.random() * 0.2,
    })
  }
  return stars
}

function makeField(count: number): FieldStar[] {
  const stars: FieldStar[] = []
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      size: 0.4 + Math.random() * 0.9,
      alpha: 0.08 + Math.random() * 0.22,
    })
  }
  return stars
}

export function mountGalaxy(options: GalaxyOptions): GalaxyHandle {
  const { canvas, reducedMotion } = options
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) {
    return { destroy() {} }
  }
  const ctx: CanvasRenderingContext2D = context

  const armStars = makeArmStars(720)
  const dust = makeArmStars(180).map((star) => ({
    ...star,
    size: star.size * 2.4,
    alpha: star.alpha * 0.28,
  }))
  const field = makeField(160)

  let destroyed = false
  let raf = 0
  let time = 0
  let lastTs = 0
  let hidden = document.hidden
  let dpr = 1

  function resize() {
    if (destroyed) return
    dpr = Math.min(window.devicePixelRatio || 1, 1.6)
    const cssW = Math.max(1, canvas.clientWidth)
    const cssH = Math.max(1, canvas.clientHeight)
    const pw = Math.round(cssW * dpr)
    const ph = Math.round(cssH * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }
  }

  function draw() {
    const w = canvas.width
    const h = canvas.height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#050814'
    ctx.fillRect(0, 0, w, h)

    ctx.fillStyle = '#c5d4ee'
    for (const star of field) {
      ctx.globalAlpha = star.alpha
      ctx.fillRect(star.x * w, star.y * h, star.size * dpr, star.size * dpr)
    }

    const radius = Math.min(w, h) * 0.46
    ctx.save()
    ctx.translate(w * 0.5, h * 0.48)
    ctx.rotate(time * SPIN_RAD_PER_SEC)
    ctx.scale(1, TILT)

    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.18)
    core.addColorStop(0, 'rgba(180, 170, 150, 0.14)')
    core.addColorStop(0.45, 'rgba(90, 100, 140, 0.05)')
    core.addColorStop(1, 'rgba(5, 8, 20, 0)')
    ctx.globalAlpha = 1
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(0, 0, radius * 0.18, 0, Math.PI * 2)
    ctx.fill()

    for (const star of dust) {
      const x = Math.cos(star.a) * star.r * radius
      const y = Math.sin(star.a) * star.r * radius
      ctx.globalAlpha = star.alpha
      ctx.fillStyle = `rgb(${Math.round(star.red * 90)}, ${Math.round(star.green * 90)}, ${Math.round(star.blue * 140)})`
      ctx.beginPath()
      ctx.arc(x, y, star.size * dpr, 0, Math.PI * 2)
      ctx.fill()
    }

    for (const star of armStars) {
      const x = Math.cos(star.a) * star.r * radius
      const y = Math.sin(star.a) * star.r * radius
      ctx.globalAlpha = star.alpha
      ctx.fillStyle = `rgb(${Math.round(star.red * 255)}, ${Math.round(star.green * 255)}, ${Math.round(star.blue * 255)})`
      ctx.beginPath()
      ctx.arc(x, y, star.size * dpr, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
    ctx.globalAlpha = 1
  }

  function loop(ts: number) {
    if (destroyed) return
    if (lastTs && !hidden) {
      time += Math.min(0.05, (ts - lastTs) / 1000)
    }
    lastTs = ts
    draw()
    if (!reducedMotion && !hidden) {
      raf = requestAnimationFrame(loop)
    }
  }

  function onVisibility() {
    hidden = document.hidden
    if (destroyed || reducedMotion) return
    if (hidden) {
      cancelAnimationFrame(raf)
      raf = 0
      lastTs = 0
      return
    }
    lastTs = 0
    if (!raf) raf = requestAnimationFrame(loop)
  }

  resize()
  if (reducedMotion) {
    time = 1.1
    draw()
  } else {
    lastTs = performance.now()
    draw()
    raf = requestAnimationFrame(loop)
  }

  const observer = new ResizeObserver(() => {
    resize()
    if (reducedMotion || hidden) draw()
  })
  observer.observe(canvas)
  document.addEventListener('visibilitychange', onVisibility)

  return {
    destroy() {
      if (destroyed) return
      destroyed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
