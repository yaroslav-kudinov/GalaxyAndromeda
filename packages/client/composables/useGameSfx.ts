export type GameSfxId = 'turn' | 'combat'

const STORAGE_KEY = 'galaxy-sfx-muted'

const SOURCES: Record<GameSfxId, string> = {
  turn: '/sounds/turn.ogg',
  combat: '/sounds/combat.ogg',
}

const muted = ref(false)
const players = new Map<GameSfxId, HTMLAudioElement>()

let hydrated = false
let unlockBound = false

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function persistMuted(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    /* quota / private mode */
  }
}

function ensurePlayers() {
  if (!import.meta.client || players.size) return
  for (const id of Object.keys(SOURCES) as GameSfxId[]) {
    const audio = new Audio(SOURCES[id])
    audio.preload = 'auto'
    audio.volume = id === 'turn' ? 0.55 : 0.62
    players.set(id, audio)
  }
}

function unlockFromGesture() {
  ensurePlayers()
  for (const audio of players.values()) {
    const wasMuted = audio.muted
    audio.muted = true
    void audio
      .play()
      .then(() => {
        audio.pause()
        audio.currentTime = 0
        audio.muted = wasMuted
      })
      .catch(() => {
        audio.muted = wasMuted
      })
  }
}

function hydrate() {
  if (hydrated || !import.meta.client) return
  hydrated = true
  muted.value = readMuted()
  ensurePlayers()
  if (!unlockBound) {
    unlockBound = true
    window.addEventListener('pointerdown', unlockFromGesture, { once: true })
  }
}

export function useGameSfx() {
  hydrate()

  function play(id: GameSfxId) {
    if (!import.meta.client || muted.value) return
    ensurePlayers()
    const audio = players.get(id)
    if (!audio) return
    audio.currentTime = 0
    void audio.play().catch(() => {
      /* autoplay until first gesture */
    })
  }

  function toggleMute() {
    muted.value = !muted.value
    persistMuted(muted.value)
  }

  return { play, muted, toggleMute }
}
