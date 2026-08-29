import { bindDocumentVisibility, isDocumentHidden, syncAudioToDocumentVisibility } from '~/utils/page-visibility-audio'

const PREFS_KEY = 'galaxy-landing-music-prefs'
const TRACK_SRC = '/audio/wreckage-of-the-throne.mp3'
const DEFAULT_VOLUME = 26
const VOLUME_STEP = 5

type LandingMusicPrefs = {
  muted: boolean
  volume: number
}

const muted = ref(false)
const volume = ref(DEFAULT_VOLUME)

let audio: HTMLAudioElement | null = null
let hydrated = false
let sessionRefs = 0
let gestureBound = false
let visibilityBound = false

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME
  return Math.min(100, Math.max(0, Math.round(value)))
}

function readPrefs(): LandingMusicPrefs {
  const fallback: LandingMusicPrefs = { muted: false, volume: DEFAULT_VOLUME }
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LandingMusicPrefs>
      return {
        muted: parsed.muted === true,
        volume: clampVolume(typeof parsed.volume === 'number' ? parsed.volume : DEFAULT_VOLUME),
      }
    }
  } catch {
    /* private mode / bad JSON */
  }
  return fallback
}

function persistPrefs() {
  const prefs: LandingMusicPrefs = {
    muted: muted.value,
    volume: volume.value,
  }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* quota / private mode */
  }
}

function applyAudioSettings() {
  if (!audio) return
  audio.volume = clampVolume(volume.value) / 100
  audio.loop = true
}

function ensureAudio() {
  if (!import.meta.client || audio) return
  audio = new Audio()
  audio.preload = 'auto'
  audio.src = TRACK_SRC
  audio.loop = true
  applyAudioSettings()
}

function bindGestureUnlock() {
  if (!import.meta.client || gestureBound) return
  gestureBound = true
  window.addEventListener(
    'pointerdown',
    () => {
      gestureBound = false
      if (sessionRefs > 0 && !muted.value) void playTheme()
    },
    { once: true },
  )
}

function playTheme(): Promise<void> {
  if (!import.meta.client || sessionRefs <= 0 || muted.value || isDocumentHidden()) {
    return Promise.resolve()
  }
  ensureAudio()
  const el = audio
  if (!el) return Promise.resolve()
  if (!el.src.endsWith(TRACK_SRC)) {
    el.src = TRACK_SRC
  }
  applyAudioSettings()
  return el
    .play()
    .then(() => undefined)
    .catch(() => {
      bindGestureUnlock()
    })
}

function onVisibilityChange() {
  syncAudioToDocumentVisibility({
    getAudio: () => audio,
    isMuted: () => muted.value,
    shouldBePlaying: () => sessionRefs > 0,
    play: () => playTheme(),
  })
}

function bindVisibility() {
  if (!import.meta.client || visibilityBound) return
  visibilityBound = true
  bindDocumentVisibility(onVisibilityChange)
}

function startSession() {
  if (!import.meta.client) return
  sessionRefs += 1
  if (sessionRefs !== 1) return
  ensureAudio()
  bindVisibility()
  if (muted.value) {
    audio?.pause()
    return
  }
  bindGestureUnlock()
  void playTheme()
}

function stopSession() {
  sessionRefs = Math.max(0, sessionRefs - 1)
  if (sessionRefs > 0) return
  audio?.pause()
}

function hydrate() {
  if (hydrated || !import.meta.client) return
  hydrated = true
  const prefs = readPrefs()
  muted.value = prefs.muted
  volume.value = prefs.volume
}

export function useLandingMusic() {
  hydrate()
  const route = useRoute()

  watch(
    () => route.path,
    (path) => {
      if (path !== '/') {
        audio?.pause()
      }
    },
  )

  onMounted(() => {
    startSession()
  })

  onUnmounted(() => {
    stopSession()
  })

  function toggleMute() {
    muted.value = !muted.value
    persistPrefs()
    if (muted.value) {
      audio?.pause()
      return
    }
    if (sessionRefs > 0) void playTheme()
  }

  function setVolume(next: number) {
    volume.value = clampVolume(next)
    persistPrefs()
    applyAudioSettings()
  }

  function nudgeVolume(delta: number) {
    setVolume(volume.value + delta)
  }

  return {
    muted,
    volume,
    volumeStep: VOLUME_STEP,
    trackTitle: 'Обломки трона',
    toggleMute,
    setVolume,
    nudgeVolume,
  }
}
