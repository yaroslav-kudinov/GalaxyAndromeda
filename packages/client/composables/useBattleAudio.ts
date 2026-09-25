import type { ShipType } from '@galaxy/rules'

/**
 * Звуки боя без звуковых файлов — синтез в браузере (Web Audio).
 *
 * Фон — низкий гул двигателей с медленной волной, шум эфира и редкий сигнал сонара; поверх —
 * выстрелы, попадания, промахи, взрывы и стук кубиков. Всё подчиняется общему выключателю звуков
 * интерфейса (`useGameSfx`): выключили — фон гаснет, новые звуки не играют.
 */

type AudioCtor = typeof AudioContext

let context: AudioContext | null = null
let master: GainNode | null = null
let whiteNoise: AudioBuffer | null = null
let brownNoise: AudioBuffer | null = null

interface AmbientNodes {
  gain: GainNode
  sources: AudioScheduledSourceNode[]
  pingTimer: ReturnType<typeof setTimeout> | null
}
let ambient: AmbientNodes | null = null
/** Сколько окон боя сейчас просят фон: окно одно, но перемонтирование не должно его рвать. */
let ambientUsers = 0

function audioContext(): AudioContext | null {
  if (!import.meta.client) return null
  if (!context) {
    const Ctor: AudioCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
    if (!Ctor) return null
    context = new Ctor()
    master = context.createGain()
    master.gain.value = 0.55
    master.connect(context.destination)
  }
  if (context.state === 'suspended') void context.resume().catch(() => {})
  return context
}

function noiseBuffer(ctx: AudioContext, kind: 'white' | 'brown'): AudioBuffer {
  if (kind === 'white' && whiteNoise) return whiteNoise
  if (kind === 'brown' && brownNoise) return brownNoise
  const length = ctx.sampleRate * 2
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1
    if (kind === 'white') {
      data[i] = white
    } else {
      // Коричневый шум: интеграл белого — глухой, «космический» фон.
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    }
  }
  if (kind === 'white') whiteNoise = buffer
  else brownNoise = buffer
  return buffer
}

/** Короткая огибающая: быстрая атака и экспоненциальный спад. */
function envelope(ctx: AudioContext, peak: number, attack: number, decay: number, at = ctx.currentTime): GainNode {
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
  return gain
}

function noiseBurst(
  ctx: AudioContext,
  opts: { peak: number; decay: number; filter: BiquadFilterType; freq: number; freqTo?: number; q?: number; delay?: number },
) {
  const at = ctx.currentTime + (opts.delay ?? 0)
  const source = ctx.createBufferSource()
  source.buffer = noiseBuffer(ctx, 'white')
  const filter = ctx.createBiquadFilter()
  filter.type = opts.filter
  filter.frequency.setValueAtTime(opts.freq, at)
  if (opts.freqTo) filter.frequency.exponentialRampToValueAtTime(opts.freqTo, at + opts.decay)
  filter.Q.value = opts.q ?? 0.8
  const gain = envelope(ctx, opts.peak, 0.005, opts.decay, at)
  source.connect(filter).connect(gain).connect(master!)
  source.start(at)
  source.stop(at + opts.decay + 0.05)
}

function tone(
  ctx: AudioContext,
  opts: { type: OscillatorType; from: number; to: number; peak: number; decay: number; delay?: number; attack?: number },
) {
  const at = ctx.currentTime + (opts.delay ?? 0)
  const osc = ctx.createOscillator()
  osc.type = opts.type
  osc.frequency.setValueAtTime(opts.from, at)
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), at + opts.decay)
  const gain = envelope(ctx, opts.peak, opts.attack ?? 0.004, opts.decay, at)
  osc.connect(gain).connect(master!)
  osc.start(at)
  osc.stop(at + (opts.attack ?? 0.004) + opts.decay + 0.05)
}

/** Высота выстрела по классу: тяжёлые орудия ниже и гулче. */
const SHOT_PITCH: Record<ShipType, number> = {
  destroyer: 1700,
  cruiser: 1250,
  carrier: 1000,
  battleship: 720,
  hyper: 480,
}

function schedulePing(nodes: AmbientNodes) {
  nodes.pingTimer = setTimeout(() => {
    const ctx = audioContext()
    if (!ctx || ambient !== nodes) return
    // Сигнал сонара: высокий чистый тон с долгим хвостом, очень тихо.
    const at = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1180, at)
    osc.frequency.exponentialRampToValueAtTime(980, at + 1.4)
    const gain = envelope(ctx, 0.018, 0.01, 1.6, at)
    osc.connect(gain).connect(nodes.gain)
    osc.start(at)
    osc.stop(at + 1.7)
    schedulePing(nodes)
  }, 6500 + Math.random() * 5500)
}

function startAmbient() {
  const ctx = audioContext()
  if (!ctx || ambient) return
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.8)
  gain.connect(master!)

  // Гул: два близких низких тона дают медленные биения, фильтр дышит от медленной волны.
  const hum = ctx.createBiquadFilter()
  hum.type = 'lowpass'
  hum.frequency.value = 320
  const humGain = ctx.createGain()
  humGain.gain.value = 0.07
  hum.connect(humGain).connect(gain)
  const low1 = ctx.createOscillator()
  low1.type = 'sawtooth'
  low1.frequency.value = 55
  const low2 = ctx.createOscillator()
  low2.type = 'sawtooth'
  low2.frequency.value = 55.6
  low1.connect(hum)
  low2.connect(hum)
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.07
  const lfoDepth = ctx.createGain()
  lfoDepth.gain.value = 140
  lfo.connect(lfoDepth).connect(hum.frequency)

  // Эфир: глухой шум через полосовой фильтр.
  const air = ctx.createBufferSource()
  air.buffer = noiseBuffer(ctx, 'brown')
  air.loop = true
  const airFilter = ctx.createBiquadFilter()
  airFilter.type = 'bandpass'
  airFilter.frequency.value = 420
  airFilter.Q.value = 0.6
  const airGain = ctx.createGain()
  airGain.gain.value = 0.05
  air.connect(airFilter).connect(airGain).connect(gain)

  const sources: AudioScheduledSourceNode[] = [low1, low2, lfo, air]
  for (const source of sources) source.start()
  ambient = { gain, sources, pingTimer: null }
  schedulePing(ambient)
}

function stopAmbient() {
  const nodes = ambient
  const ctx = context
  if (!nodes || !ctx) return
  ambient = null
  if (nodes.pingTimer) clearTimeout(nodes.pingTimer)
  nodes.gain.gain.cancelScheduledValues(ctx.currentTime)
  nodes.gain.gain.setValueAtTime(Math.max(0.0001, nodes.gain.gain.value), ctx.currentTime)
  nodes.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9)
  for (const source of nodes.sources) {
    try {
      source.stop(ctx.currentTime + 1)
    } catch {
      /* уже остановлен */
    }
  }
}

export function useBattleAudio() {
  const { muted } = useGameSfx()

  function play(run: (ctx: AudioContext) => void) {
    if (muted.value) return
    const ctx = audioContext()
    if (!ctx || !master) return
    run(ctx)
  }

  /** Фон боя — пока открыто окно. Возвращает функцию, которая его отпускает. */
  function holdAmbient(): () => void {
    ambientUsers += 1
    if (!muted.value) startAmbient()
    let released = false
    return () => {
      if (released) return
      released = true
      ambientUsers = Math.max(0, ambientUsers - 1)
      if (ambientUsers === 0) stopAmbient()
    }
  }

  watch(muted, (value) => {
    if (value) stopAmbient()
    else if (ambientUsers > 0) startAmbient()
  })

  function shot(type: ShipType, delay = 0) {
    play((ctx) => {
      const pitch = SHOT_PITCH[type] * (0.94 + Math.random() * 0.12)
      tone(ctx, { type: 'sawtooth', from: pitch, to: pitch * 0.18, peak: 0.07, decay: 0.2, delay })
      noiseBurst(ctx, { peak: 0.03, decay: 0.08, filter: 'highpass', freq: 2500, delay })
    })
  }

  function hit(delay = 0) {
    play((ctx) => {
      noiseBurst(ctx, { peak: 0.14, decay: 0.16, filter: 'bandpass', freq: 1400, freqTo: 500, q: 1.1, delay })
      tone(ctx, { type: 'sine', from: 150, to: 55, peak: 0.12, decay: 0.2, delay })
    })
  }

  function miss(delay = 0) {
    play((ctx) => {
      noiseBurst(ctx, { peak: 0.025, decay: 0.14, filter: 'bandpass', freq: 3200, freqTo: 1800, q: 2, delay })
    })
  }

  function explosion(delay = 0) {
    play((ctx) => {
      noiseBurst(ctx, { peak: 0.3, decay: 1.3, filter: 'lowpass', freq: 2200, freqTo: 160, q: 0.7, delay })
      tone(ctx, { type: 'sine', from: 90, to: 30, peak: 0.26, decay: 0.9, delay, attack: 0.01 })
      noiseBurst(ctx, { peak: 0.08, decay: 0.5, filter: 'highpass', freq: 1800, delay: delay + 0.12 })
    })
  }

  function diceRoll() {
    play((ctx) => {
      for (let i = 0; i < 5; i++) {
        noiseBurst(ctx, { peak: 0.05, decay: 0.03, filter: 'highpass', freq: 2600, delay: i * (0.045 + Math.random() * 0.03) })
      }
    })
  }

  /** Тихий щелчок: кубик назначен или снят. */
  function tick() {
    play((ctx) => {
      tone(ctx, { type: 'triangle', from: 900, to: 700, peak: 0.035, decay: 0.05 })
    })
  }

  return { holdAmbient, shot, hit, miss, explosion, diceRoll, tick }
}
