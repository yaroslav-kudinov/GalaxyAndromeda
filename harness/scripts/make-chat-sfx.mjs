/**
 * Генератор звука уведомления чата: packages/client/public/sounds/chat.wav
 *
 * Две короткие ноты вверх (C6 → F6) с мягкой атакой и экспоненциальным спадом.
 * Сгенерировано для проекта, сторонних лицензий не требует.
 *
 *   node harness/scripts/make-chat-sfx.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SAMPLE_RATE = 32000
const DURATION_S = 0.34
const PEAK = 0.55

/** Ноты: частота (Гц), старт (с), длительность звучания (с), громкость */
const NOTES = [
  { freq: 1046.5, start: 0.0, decay: 0.16, gain: 1.0 },
  { freq: 1396.9, start: 0.085, decay: 0.2, gain: 0.92 },
]

const ATTACK_S = 0.005

function noteAt(note, t) {
  const dt = t - note.start
  if (dt < 0) return 0
  const attack = dt < ATTACK_S ? dt / ATTACK_S : 1
  const env = attack * Math.exp(-dt / note.decay)
  const phase = 2 * Math.PI * note.freq * dt
  // основной тон + тихая октава сверху для «стеклянного» оттенка
  const wave = Math.sin(phase) + 0.22 * Math.sin(2 * phase)
  return note.gain * env * wave
}

function renderSamples() {
  const total = Math.round(SAMPLE_RATE * DURATION_S)
  const raw = new Float64Array(total)
  let max = 0
  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE
    let value = 0
    for (const note of NOTES) value += noteAt(note, t)
    // общий фейд в конце, чтобы не было щелчка на обрыве
    const tailStart = DURATION_S - 0.03
    if (t > tailStart) value *= (DURATION_S - t) / 0.03
    raw[i] = value
    max = Math.max(max, Math.abs(value))
  }
  const norm = max > 0 ? PEAK / max : 0
  const pcm = new Int16Array(total)
  for (let i = 0; i < total; i += 1) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(raw[i] * norm * 32767)))
  }
  return pcm
}

function wavFile(pcm) {
  const dataBytes = pcm.length * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // размер блока fmt
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // моно
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28) // байт в секунду
  buffer.writeUInt16LE(2, 32) // выравнивание блока
  buffer.writeUInt16LE(16, 34) // бит на отсчёт
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < pcm.length; i += 1) buffer.writeInt16LE(pcm[i], 44 + i * 2)
  return buffer
}

const outPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../packages/client/public/sounds/chat.wav',
)
mkdirSync(dirname(outPath), { recursive: true })
const file = wavFile(renderSamples())
writeFileSync(outPath, file)
console.log(`chat.wav: ${file.length} байт, ${SAMPLE_RATE} Гц, ${DURATION_S}s`)
