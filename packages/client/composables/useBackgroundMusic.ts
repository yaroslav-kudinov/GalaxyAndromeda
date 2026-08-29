import { bindDocumentVisibility, isDocumentHidden, syncAudioToDocumentVisibility } from '~/utils/page-visibility-audio'
import { clampTrackTime } from '~/utils/track-time'

export type MusicRepeatMode = 'playlist' | 'one'

export interface SoundtrackTrack {
  id: string
  src: string
  title: string
}

export const SOUNDTRACK_TRACKS: readonly SoundtrackTrack[] = [
  { id: 'strategium', src: '/audio/strategium.mp3', title: 'Стратегиум' },
  { id: 'strategium-ii', src: '/audio/strategium-ii.mp3', title: 'Стратегиум II' },
  { id: 'cold-calculation', src: '/audio/cold-calculation.mp3', title: 'Холодный расчёт' },
  { id: 'cosmic-minimalism', src: '/audio/cosmic-minimalism.mp3', title: 'Космический минимализм' },
  { id: 'cosmic-minimalism-ii', src: '/audio/cosmic-minimalism-ii.mp3', title: 'Космический минимализм II' },
  { id: 'whisper-of-intrigue', src: '/audio/whisper-of-intrigue.mp3', title: 'Шёпот интриг' },
  { id: 'wreckage-of-the-throne', src: '/audio/wreckage-of-the-throne.mp3', title: 'Обломки трона' },
  { id: 'shadow-of-war', src: '/audio/shadow-of-war.mp3', title: 'Тень войны' },
  { id: 'data-sync', src: '/audio/data-sync.mp3', title: 'Синхрон данных' },
  { id: 'technological-breakthrough', src: '/audio/technological-breakthrough.mp3', title: 'Технологический прорыв' },
]

const PREFS_KEY = 'galaxy-music-prefs'
const LEGACY_MUTE_KEY = 'galaxy-music-muted'
const DEFAULT_VOLUME = 26
const VOLUME_STEP = 5

type MusicPrefs = {
  muted: boolean
  volume: number
  shuffle: boolean
  repeat: MusicRepeatMode
  excluded: string[]
}

const muted = ref(false)
const userPaused = ref(false)
const volume = ref(DEFAULT_VOLUME)
const shuffle = ref(true)
const repeatMode = ref<MusicRepeatMode>('playlist')
const excludedIds = ref<string[]>([])
const currentTrackId = ref<string | null>(null)
const currentTime = ref(0)
const duration = ref(0)

let audio: HTMLAudioElement | null = null
let playlist: string[] = []
let trackIndex = 0
let hydrated = false
let sessionRefs = 0
let gestureBound = false
let visibilityBound = false

const knownIds = new Set(SOUNDTRACK_TRACKS.map((track) => track.id))

function trackById(id: string | null | undefined): SoundtrackTrack | undefined {
  if (!id) return undefined
  return SOUNDTRACK_TRACKS.find((track) => track.id === id)
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME
  return Math.min(100, Math.max(0, Math.round(value)))
}

function sanitizeExcluded(ids: string[]): string[] {
  const unique = [...new Set(ids.filter((id) => knownIds.has(id)))]
  if (unique.length >= SOUNDTRACK_TRACKS.length) return []
  return unique
}

function readPrefs(): MusicPrefs {
  const fallback: MusicPrefs = {
    muted: false,
    volume: DEFAULT_VOLUME,
    shuffle: true,
    repeat: 'playlist',
    excluded: [],
  }
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MusicPrefs>
      return {
        muted: parsed.muted === true,
        volume: clampVolume(typeof parsed.volume === 'number' ? parsed.volume : DEFAULT_VOLUME),
        shuffle: parsed.shuffle !== false,
        repeat: parsed.repeat === 'one' ? 'one' : 'playlist',
        excluded: sanitizeExcluded(Array.isArray(parsed.excluded) ? parsed.excluded : []),
      }
    }
  } catch {
    /* private mode / bad JSON */
  }
  try {
    fallback.muted = localStorage.getItem(LEGACY_MUTE_KEY) === '1'
  } catch {
    /* quota / private mode */
  }
  return fallback
}

function persistPrefs() {
  const prefs: MusicPrefs = {
    muted: muted.value,
    volume: volume.value,
    shuffle: shuffle.value,
    repeat: repeatMode.value,
    excluded: excludedIds.value,
  }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    localStorage.setItem(LEGACY_MUTE_KEY, muted.value ? '1' : '0')
  } catch {
    /* quota / private mode */
  }
}

function shuffleIds(ids: string[], avoid: string | null): string[] {
  const next = [...ids]
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = next[i]!
    next[i] = next[j]!
    next[j] = swap
  }
  if (avoid && next.length > 1 && next[0] === avoid) {
    const swapAt = next.findIndex((id, index) => index > 0 && id !== avoid)
    if (swapAt > 0) {
      const head = next[0]!
      next[0] = next[swapAt]!
      next[swapAt] = head
    }
  }
  return next
}

function enabledIds(): string[] {
  const ids = SOUNDTRACK_TRACKS.map((track) => track.id).filter((id) => !excludedIds.value.includes(id))
  return ids.length ? ids : SOUNDTRACK_TRACKS.map((track) => track.id)
}

function rebuildPlaylist(preferId?: string | null) {
  const enabled = enabledIds()
  const avoid = preferId === undefined ? currentTrackId.value : preferId
  playlist = shuffle.value ? shuffleIds(enabled, avoid) : enabled
  const candidate = preferId === undefined ? currentTrackId.value : preferId
  const want = candidate && playlist.includes(candidate) ? candidate : playlist[0]
  trackIndex = want ? Math.max(0, playlist.indexOf(want)) : 0
  currentTrackId.value = playlist[trackIndex] ?? null
}

function applyAudioSettings() {
  if (!audio) return
  audio.volume = clampVolume(volume.value) / 100
  audio.muted = muted.value
  audio.loop = repeatMode.value === 'one'
}

function syncPlaybackClock() {
  if (!audio) {
    currentTime.value = 0
    duration.value = 0
    return
  }
  currentTime.value = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
  const loaded = audio.duration
  duration.value = Number.isFinite(loaded) && loaded > 0 ? loaded : 0
}

function onPlaybackClock() {
  syncPlaybackClock()
}

function ensureAudio() {
  if (!import.meta.client || audio) return
  audio = new Audio()
  audio.preload = 'auto'
  audio.addEventListener('ended', onTrackEnded)
  audio.addEventListener('timeupdate', onPlaybackClock)
  audio.addEventListener('durationchange', onPlaybackClock)
  audio.addEventListener('loadedmetadata', onPlaybackClock)
  audio.addEventListener('seeked', onPlaybackClock)
  applyAudioSettings()
}

function bindGestureUnlock() {
  if (!import.meta.client || gestureBound) return
  gestureBound = true
  window.addEventListener(
    'pointerdown',
    () => {
      gestureBound = false
      if (sessionRefs > 0 && !userPaused.value) void playCurrent()
    },
    { once: true },
  )
}

function playCurrent(): Promise<void> {
  if (!import.meta.client || sessionRefs <= 0 || userPaused.value || isDocumentHidden()) {
    return Promise.resolve()
  }
  ensureAudio()
  if (!playlist.length) rebuildPlaylist(currentTrackId.value)
  const el = audio
  const id = playlist[trackIndex]
  const track = trackById(id)
  if (!el || !track) return Promise.resolve()
  currentTrackId.value = track.id
  if (!el.src.endsWith(track.src)) {
    el.src = track.src
  }
  applyAudioSettings()
  return el.play().then(() => undefined).catch(() => {
    bindGestureUnlock()
  })
}

function onTrackEnded() {
  if (sessionRefs <= 0 || userPaused.value) return
  if (repeatMode.value === 'one') {
    void playCurrent()
    return
  }
  const endedId = playlist[trackIndex] ?? currentTrackId.value
  trackIndex += 1
  if (trackIndex >= playlist.length) {
    playlist = shuffle.value ? shuffleIds(enabledIds(), endedId) : enabledIds()
    trackIndex = 0
  }
  void playCurrent()
}

function onVisibilityChange() {
  syncAudioToDocumentVisibility({
    getAudio: () => audio,
    isMuted: () => userPaused.value,
    shouldBePlaying: () => sessionRefs > 0,
    play: () => playCurrent(),
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
  rebuildPlaylist(currentTrackId.value)
  bindVisibility()
  if (userPaused.value) {
    audio?.pause()
    return
  }
  bindGestureUnlock()
  void playCurrent()
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
  shuffle.value = prefs.shuffle
  repeatMode.value = prefs.repeat
  excludedIds.value = prefs.excluded
}

export function useBackgroundMusic() {
  hydrate()

  onMounted(() => {
    startSession()
  })

  onUnmounted(() => {
    stopSession()
  })

  const currentTitle = computed(() => trackById(currentTrackId.value)?.title ?? null)
  const enabledCount = computed(() => SOUNDTRACK_TRACKS.length - excludedIds.value.length)

  function isExcluded(id: string): boolean {
    return excludedIds.value.includes(id)
  }

  function toggleMute() {
    muted.value = !muted.value
    persistPrefs()
    applyAudioSettings()
  }

  function togglePause() {
    if (userPaused.value) {
      userPaused.value = false
      if (sessionRefs > 0) void playCurrent()
      return
    }
    userPaused.value = true
    audio?.pause()
  }

  function seekTo(seconds: number) {
    ensureAudio()
    const el = audio
    if (!el) return
    if (!playlist.length) rebuildPlaylist(currentTrackId.value)
    const id = playlist[trackIndex]
    const track = trackById(id)
    if (track && !el.src.endsWith(track.src)) {
      el.src = track.src
      applyAudioSettings()
    }
    const loaded = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration.value
    el.currentTime = clampTrackTime(seconds, loaded)
    syncPlaybackClock()
  }

  function setVolume(next: number) {
    volume.value = clampVolume(next)
    persistPrefs()
    applyAudioSettings()
  }

  function nudgeVolume(delta: number) {
    setVolume(volume.value + delta)
  }

  function toggleShuffle() {
    shuffle.value = !shuffle.value
    persistPrefs()
    rebuildPlaylist(currentTrackId.value)
  }

  function toggleRepeat() {
    repeatMode.value = repeatMode.value === 'one' ? 'playlist' : 'one'
    persistPrefs()
    applyAudioSettings()
  }

  function selectTrack(id: string) {
    if (!knownIds.has(id)) return
    if (excludedIds.value.includes(id)) {
      excludedIds.value = excludedIds.value.filter((item) => item !== id)
    }
    persistPrefs()
    rebuildPlaylist(id)
    userPaused.value = false
    if (audio && currentTrackId.value === id && audio.src.endsWith(trackById(id)?.src ?? '')) {
      audio.currentTime = 0
      syncPlaybackClock()
    }
    currentTrackId.value = id
    if (muted.value) {
      muted.value = false
      persistPrefs()
      applyAudioSettings()
    }
    void playCurrent()
  }

  function toggleExcluded(id: string) {
    if (!knownIds.has(id)) return
    const hiding = !excludedIds.value.includes(id)
    if (hiding && enabledCount.value <= 1) return
    excludedIds.value = hiding
      ? [...excludedIds.value, id]
      : excludedIds.value.filter((item) => item !== id)
    persistPrefs()
    const prefer = hiding && currentTrackId.value === id ? null : currentTrackId.value
    rebuildPlaylist(prefer)
    if (hiding && currentTrackId.value === id && sessionRefs > 0 && !userPaused.value) {
      void playCurrent()
    }
  }

  return {
    tracks: SOUNDTRACK_TRACKS,
    currentTrackId,
    currentTitle,
    currentTime,
    duration,
    muted,
    paused: userPaused,
    volume,
    shuffle,
    repeatMode,
    excludedIds,
    enabledCount,
    volumeStep: VOLUME_STEP,
    isExcluded,
    toggleMute,
    togglePause,
    seekTo,
    setVolume,
    nudgeVolume,
    toggleShuffle,
    toggleRepeat,
    selectTrack,
    toggleExcluded,
  }
}
