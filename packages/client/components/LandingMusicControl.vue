<script setup lang="ts">
const { muted, volume, volumeStep, toggleMute, setVolume, nudgeVolume } = useLandingMusic()

function onVolumeInput(event: Event) {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  setVolume(Number(target.value))
}

const muteLabel = computed(() =>
  muted.value ? 'Включить музыку главной страницы' : 'Заглушить музыку главной страницы',
)
</script>

<template>
  <div class="landing-music">
    <div class="landing-music-row">
      <button
        type="button"
        class="landing-music-icon"
        :class="{ 'landing-music-icon--off': muted }"
        :aria-pressed="muted"
        :aria-label="muteLabel"
        :title="muteLabel"
        @click="toggleMute"
      >
        <MusicGlyph :name="muted ? 'mute' : 'unmute'" />
      </button>
      <button
        type="button"
        class="landing-music-icon"
        aria-label="Тише"
        title="Тише"
        :disabled="volume <= 0"
        @click="nudgeVolume(-volumeStep)"
      >
        <MusicGlyph name="vol-down" />
      </button>
      <input
        id="landing-music-volume"
        class="landing-music-range"
        type="range"
        min="0"
        max="100"
        step="1"
        :value="volume"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuenow="volume"
        aria-label="Громкость музыки главной страницы"
        @input="onVolumeInput"
      >
      <button
        type="button"
        class="landing-music-icon"
        aria-label="Громче"
        title="Громче"
        :disabled="volume >= 100"
        @click="nudgeVolume(volumeStep)"
      >
        <MusicGlyph name="vol-up" />
      </button>
      <span class="landing-music-value" aria-hidden="true">{{ volume }}</span>
    </div>
  </div>
</template>

<style scoped>
.landing-music {
  position: fixed;
  z-index: 20;
  top: 0.85rem;
  right: 0.75rem;
  box-sizing: border-box;
  width: min(16.5rem, calc(100vw - 1.5rem));
  padding: 0.38rem 0.5rem 0.4rem;
  border: 1px solid #33415599;
  border-radius: 10px;
  background: #0f172ad9;
  color: #e2e8f0;
  backdrop-filter: blur(8px);
}

.landing-music-row {
  display: flex;
  align-items: center;
  gap: 0.28rem;
}

.landing-music-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  padding: 0;
  border-radius: 6px;
  border: 1px solid #64748b;
  background: #1e293b;
  color: #e2e8f0;
  cursor: pointer;
}

.landing-music-icon:hover:not(:disabled) {
  border-color: #94a3b8;
  background: #334155;
}

.landing-music-icon--off {
  opacity: 0.7;
  color: #94a3b8;
}

.landing-music-icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.landing-music-range {
  flex: 1;
  min-width: 0;
  accent-color: #60a5fa;
}

.landing-music-value {
  width: 1.55rem;
  font-size: 0.7rem;
  text-align: right;
  color: #cbd5e1;
  font-variant-numeric: tabular-nums;
}
</style>
