<script setup lang="ts">
import { clampTrackTime, formatTrackTime } from '~/utils/track-time'

const props = withDefaults(
  defineProps<{
    placement?: 'hud' | 'lobby'
  }>(),
  { placement: 'hud' },
)

const volumeInputId = computed(() =>
  props.placement === 'lobby' ? 'soundtrack-volume-lobby' : 'soundtrack-volume-hud',
)
const volumePanelId = computed(() => `${volumeInputId.value}-panel`)
const seekInputId = computed(() =>
  props.placement === 'lobby' ? 'soundtrack-seek-lobby' : 'soundtrack-seek-hud',
)

const {
  tracks,
  currentTrackId,
  currentTitle,
  currentTime,
  duration,
  muted,
  paused,
  volume,
  shuffle,
  repeatMode,
  enabledCount,
  volumeStep,
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
} = useBackgroundMusic()

const open = ref(false)
const volumeOpen = ref(false)
const triggerRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})

function placePanel() {
  const trigger = triggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const width = Math.min(300, window.innerWidth - 16)
  const maxHeight = Math.min(props.placement === 'lobby' ? 520 : 460, window.innerHeight - 16)
  let left = rect.right - width
  if (left < 8) left = 8
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
  const gap = 6
  const spaceBelow = window.innerHeight - rect.bottom - gap - 8
  const spaceAbove = rect.top - gap - 8
  const openUp = spaceBelow < 280 && spaceAbove > spaceBelow
  let top = openUp ? Math.max(8, rect.top - maxHeight - gap) : rect.bottom + gap
  const available = window.innerHeight - top - 8
  const height = Math.min(maxHeight, Math.max(240, available))
  if (openUp) {
    top = Math.max(8, rect.top - height - gap)
  }
  panelStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(height)}px`,
  }
}

function closePanel() {
  open.value = false
}

function togglePanel() {
  open.value = !open.value
  if (open.value) {
    nextTick(() => {
      placePanel()
      nextTick(() => placePanel())
    })
  }
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!open.value) return
  const target = event.target as Node | null
  if (!target) return
  if (triggerRef.value?.contains(target) || panelRef.value?.contains(target)) return
  closePanel()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.stopPropagation()
    closePanel()
    triggerRef.value?.focus()
  }
}

function onVolumeInput(event: Event) {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  setVolume(Number(target.value))
}

function onSeekInput(event: Event) {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  seekTo(Number(target.value))
}

const elapsedLabel = computed(() => formatTrackTime(currentTime.value))
const durationLabel = computed(() => formatTrackTime(duration.value))
const canSeek = computed(() => duration.value > 0)
const seekValue = computed(() => clampTrackTime(currentTime.value, duration.value))

watch(open, (isOpen) => {
  if (!import.meta.client) return
  if (!isOpen) volumeOpen.value = false
  if (isOpen) {
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    window.addEventListener('keydown', onKeydown, true)
    window.addEventListener('resize', placePanel)
    window.addEventListener('scroll', placePanel, true)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('resize', placePanel)
    window.removeEventListener('scroll', placePanel, true)
  }
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('resize', placePanel)
  window.removeEventListener('scroll', placePanel, true)
})
</script>

<template>
  <div class="soundtrack" :class="{ 'soundtrack--lobby': placement === 'lobby' }">
    <button
      ref="triggerRef"
      type="button"
      class="soundtrack-trigger"
      :class="{ 'soundtrack-trigger--off': muted }"
      :title="open ? 'Скрыть управление музыкой' : 'Управление музыкой'"
      :aria-label="open ? 'Скрыть управление музыкой' : 'Управление музыкой'"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :aria-pressed="!muted"
      @click="togglePanel"
    >
      <MusicGlyph :name="muted ? 'mute' : 'music'" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        class="soundtrack-panel"
        :class="{ 'soundtrack-panel--lobby': placement === 'lobby' }"
        :style="panelStyle"
        role="dialog"
        aria-label="Управление саундтреком"
      >
        <p class="soundtrack-heading">Саундтрек</p>

        <div class="soundtrack-now-block">
          <p class="soundtrack-now-title">{{ currentTitle ?? 'Нет пьесы' }}</p>
          <div class="soundtrack-transport">
            <button
              type="button"
              class="soundtrack-play"
              :aria-label="paused ? 'Играть' : 'Пауза'"
              :title="paused ? 'Играть' : 'Пауза'"
              @click="togglePause"
            >
              <MusicGlyph :name="paused ? 'play' : 'pause'" />
            </button>
            <label class="soundtrack-seek-wrap" :for="seekInputId">
              <span class="soundtrack-time" aria-hidden="true">{{ elapsedLabel }}</span>
              <input
                :id="seekInputId"
                class="soundtrack-range soundtrack-range--seek"
                type="range"
                min="0"
                :max="duration || 0"
                step="0.1"
                :value="seekValue"
                :disabled="!canSeek"
                :aria-valuemin="0"
                :aria-valuemax="duration || 0"
                :aria-valuenow="seekValue"
                :aria-valuetext="`${elapsedLabel} из ${durationLabel}`"
                aria-label="Положение в пьесе"
                @input="onSeekInput"
              >
              <span class="soundtrack-time" aria-hidden="true">{{ durationLabel }}</span>
            </label>
          </div>
        </div>

        <ul class="soundtrack-tracks">
          <li v-for="track in tracks" :key="track.id" class="soundtrack-track">
            <button
              type="button"
              class="soundtrack-track-play"
              :class="{
                'soundtrack-track-play--current': currentTrackId === track.id,
                'soundtrack-track-play--excluded': isExcluded(track.id),
              }"
              :aria-current="currentTrackId === track.id ? 'true' : undefined"
              :aria-label="
                currentTrackId === track.id
                  ? paused
                    ? `${track.title}, на паузе`
                    : `${track.title}, играет сейчас`
                  : `Слушать: ${track.title}`
              "
              @click="selectTrack(track.id)"
            >
              <span class="soundtrack-track-name">{{ track.title }}</span>
              <span v-if="currentTrackId === track.id" class="soundtrack-now">
                {{ paused ? 'пауза' : 'сейчас' }}
              </span>
            </button>
            <button
              type="button"
              class="soundtrack-exclude"
              :disabled="!isExcluded(track.id) && enabledCount <= 1"
              :aria-label="
                isExcluded(track.id)
                  ? `Вернуть в список: ${track.title}`
                  : `Исключить из списка: ${track.title}`
              "
              :title="
                isExcluded(track.id)
                  ? 'Вернуть в список'
                  : enabledCount <= 1
                    ? 'Хотя бы одна пьеса должна остаться'
                    : 'Исключить из списка'
              "
              @click="toggleExcluded(track.id)"
            >
              <MusicGlyph :name="isExcluded(track.id) ? 'restore' : 'exclude'" />
            </button>
          </li>
        </ul>

        <div class="soundtrack-controls">
          <button
            type="button"
            class="soundtrack-chip"
            :class="{ 'soundtrack-chip--on': shuffle }"
            :aria-pressed="shuffle"
            aria-label="Перемешать список"
            title="Перемешать список"
            @click="toggleShuffle"
          >
            <MusicGlyph name="shuffle" />
          </button>
          <button
            type="button"
            class="soundtrack-chip"
            :class="{ 'soundtrack-chip--on': repeatMode === 'one' }"
            :aria-pressed="repeatMode === 'one'"
            :aria-label="
              repeatMode === 'one' ? 'Повтор этой пьесы' : 'Повтор всего списка'
            "
            :title="repeatMode === 'one' ? 'Повтор этой пьесы' : 'Повтор всего списка'"
            @click="toggleRepeat"
          >
            <MusicGlyph :name="repeatMode === 'one' ? 'repeat-one' : 'repeat'" />
          </button>
          <button
            type="button"
            class="soundtrack-chip"
            :class="{ 'soundtrack-chip--on': muted }"
            :aria-pressed="muted"
            :aria-label="muted ? 'Включить музыку' : 'Заглушить музыку'"
            :title="muted ? 'Включить музыку' : 'Заглушить музыку'"
            @click="toggleMute"
          >
            <MusicGlyph :name="muted ? 'mute' : 'unmute'" />
          </button>
        </div>

        <div class="soundtrack-volume">
          <button
            type="button"
            class="soundtrack-volume-toggle"
            :aria-expanded="volumeOpen"
            :aria-controls="volumePanelId"
            :aria-label="volumeOpen ? 'Скрыть громкость' : 'Громкость'"
            :title="volumeOpen ? 'Скрыть громкость' : 'Громкость'"
            @click="volumeOpen = !volumeOpen"
          >
            <MusicGlyph name="volume" />
            <span class="soundtrack-volume-value" aria-hidden="true">{{ volume }}</span>
            <span class="soundtrack-volume-caret" aria-hidden="true">{{ volumeOpen ? '▴' : '▾' }}</span>
          </button>
          <div
            v-if="volumeOpen"
            :id="volumePanelId"
            class="soundtrack-volume-body"
          >
            <div class="soundtrack-volume-row">
              <button
                type="button"
                class="soundtrack-vol-btn"
                aria-label="Тише"
                title="Тише"
                :disabled="volume <= 0"
                @click="nudgeVolume(-volumeStep)"
              >
                <MusicGlyph name="vol-down" />
              </button>
              <input
                :id="volumeInputId"
                class="soundtrack-range"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="volume"
                :aria-valuemin="0"
                :aria-valuemax="100"
                :aria-valuenow="volume"
                aria-label="Громкость"
                @input="onVolumeInput"
              >
              <button
                type="button"
                class="soundtrack-vol-btn"
                aria-label="Громче"
                title="Громче"
                :disabled="volume >= 100"
                @click="nudgeVolume(volumeStep)"
              >
                <MusicGlyph name="vol-up" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.soundtrack--lobby {
  margin-top: 0.85rem;
}

.soundtrack-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border-radius: 6px;
  border: 1px solid #64748b;
  background: #1e293b;
  color: #e2e8f0;
  line-height: 1;
  cursor: pointer;
}

.soundtrack-trigger:hover {
  border-color: #94a3b8;
  background: #334155;
}

.soundtrack-trigger--off {
  opacity: 0.65;
  color: #94a3b8;
}

.soundtrack-panel {
  position: fixed;
  z-index: 260;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0.65rem 0.7rem 0.75rem;
  border: 1px solid #475569;
  border-radius: 10px;
  background: #0f172af7;
  box-shadow: 0 10px 28px #00000080;
  color: #e2e8f0;
  font-family: Manrope, system-ui, sans-serif;
}

.soundtrack-heading {
  flex-shrink: 0;
  margin: 0 0 0.45rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #93c5fd;
}

.soundtrack-now-block {
  flex-shrink: 0;
  margin: 0 0 0.55rem;
  padding: 0.4rem 0.45rem 0.45rem;
  border-radius: 8px;
  background: #1e293b;
}

.soundtrack-now-title {
  margin: 0 0 0.35rem;
  font-size: 0.78rem;
  font-weight: 600;
  line-height: 1.3;
  color: #f8fafc;
}

.soundtrack-transport {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.soundtrack-play {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9rem;
  height: 1.9rem;
  padding: 0;
  border-radius: 6px;
  border: 1px solid #60a5fa;
  background: #1e3a8a;
  color: #e2e8f0;
  cursor: pointer;
}

.soundtrack-play:hover {
  border-color: #93c5fd;
  background: #1d4ed8;
}

.soundtrack-seek-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.28rem;
  min-width: 0;
}

.soundtrack-time {
  flex-shrink: 0;
  width: 2.1rem;
  font-size: 0.65rem;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.soundtrack-time:last-child {
  text-align: right;
}

.soundtrack-tracks {
  flex: 1 1 auto;
  min-height: 0;
  max-height: 12.5rem;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  margin: 0 0 0.55rem;
  padding: 0 0.2rem 0.1rem 0;
  list-style: none;
}

.soundtrack-panel--lobby .soundtrack-tracks {
  max-height: 15rem;
}

.soundtrack-track {
  display: flex;
  align-items: stretch;
  gap: 0.3rem;
  margin-bottom: 0.28rem;
}

.soundtrack-track:last-child {
  margin-bottom: 0;
}

.soundtrack-track-play {
  flex: 1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem;
  min-width: 0;
  padding: 0.28rem 0.4rem;
  border-radius: 6px;
  border: 1px solid transparent;
  background: #1e293b;
  color: #e2e8f0;
  text-align: left;
  cursor: pointer;
}

.soundtrack-track-play:hover {
  border-color: #64748b;
  background: #334155;
}

.soundtrack-track-play--current {
  border-color: #3b82f6;
  background: #1e3a8a;
}

.soundtrack-track-play--excluded {
  opacity: 0.55;
}

.soundtrack-track-name {
  font-size: 0.78rem;
  line-height: 1.25;
}

.soundtrack-now {
  flex-shrink: 0;
  font-size: 0.65rem;
  color: #93c5fd;
}

.soundtrack-exclude {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  padding: 0;
  border-radius: 6px;
  border: 1px solid #475569;
  background: transparent;
  color: #cbd5e1;
  cursor: pointer;
}

.soundtrack-exclude:hover:not(:disabled) {
  border-color: #94a3b8;
  color: #f8fafc;
}

.soundtrack-exclude:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.soundtrack-controls {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-bottom: 0.4rem;
}

.soundtrack-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9rem;
  height: 1.9rem;
  padding: 0;
  border-radius: 6px;
  border: 1px solid #64748b;
  background: #1e293b;
  color: #e2e8f0;
  cursor: pointer;
}

.soundtrack-chip:hover {
  border-color: #94a3b8;
  background: #334155;
}

.soundtrack-chip--on {
  border-color: #60a5fa;
  background: #1e3a8a;
}

.soundtrack-volume {
  flex-shrink: 0;
}

.soundtrack-volume-toggle {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  padding: 0.22rem 0.45rem;
  border-radius: 6px;
  border: 1px solid #64748b;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 0.72rem;
  cursor: pointer;
  text-align: left;
}

.soundtrack-volume-toggle:hover {
  border-color: #94a3b8;
  background: #334155;
}

.soundtrack-volume-value {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: #cbd5e1;
}

.soundtrack-volume-caret {
  color: #94a3b8;
}

.soundtrack-volume-body {
  margin-top: 0.35rem;
}

.soundtrack-volume-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.soundtrack-vol-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  padding: 0;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #1e293b;
  color: #e2e8f0;
  cursor: pointer;
}

.soundtrack-vol-btn:hover:not(:disabled) {
  border-color: #94a3b8;
  background: #334155;
}

.soundtrack-vol-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.soundtrack-range {
  flex: 1;
  min-width: 0;
  accent-color: #60a5fa;
}

.soundtrack-range:disabled {
  opacity: 0.45;
}

.soundtrack-range--seek {
  min-width: 4rem;
}
</style>
