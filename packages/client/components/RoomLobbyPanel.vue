<script setup lang="ts">
import type { LobbyPlayerSlot } from '~/components/LobbyPlayerList.vue'
import type { RoomBootstrap } from '~/composables/useGameApi'
import { joinAsLabel } from '~/utils/lobby-slot'
import { useUiStrings } from '~/i18n/ui-strings'

const props = defineProps<{
  mode: 'join' | 'prep'
  bootstrap: RoomBootstrap | null
  slots: LobbyPlayerSlot[]
  selectedSlot: string | null
  currentPlayerId?: string | null
  nickname: string
  hasNickname: boolean
  busy: boolean
  roomFull: boolean
  error: string | null
  isHost: boolean
  inviteCopied: boolean
}>()

const emit = defineEmits<{
  'update:selectedSlot': [value: string | null]
  join: []
  start: []
  close: []
  copyInvite: []
  slotPick: [value: string | null]
}>()

const t = useUiStrings().lobby
const moreOpen = ref(false)

const playersLine = computed(() => {
  if (!props.bootstrap) return ''
  let line = t.playersMeta(props.bootstrap.playerCount, props.bootstrap.maxPlayers)
  if (props.bootstrap.code) line += ` · ${t.codeMeta(props.bootstrap.code)}`
  if (props.mode === 'join' && props.bootstrap.status === 'playing') {
    line += ` · ${t.playingHint}`
  }
  return line
})

function onSlotUpdate(value: string | null) {
  emit('update:selectedSlot', value)
  if (props.mode === 'prep') emit('slotPick', value)
}
</script>

<template>
  <div class="room-lobby">
    <template v-if="mode === 'join'">
      <form class="lobby-form" @submit.prevent="emit('join')">
        <header class="lobby-hero">
          <h2>{{ t.titleJoin }}</h2>
          <p v-if="playersLine" class="lobby-meta">{{ playersLine }}</p>
        </header>

        <div v-if="slots.length" class="lobby-section">
          <h3 class="lobby-section-title">{{ t.pickSlotJoin }}</h3>
          <LobbySlotPicker
            :model-value="selectedSlot"
            :slots="slots"
            :disabled="busy || roomFull"
            @update:model-value="onSlotUpdate"
          />
        </div>

        <p v-if="roomFull" class="lobby-error">{{ t.roomFull }}</p>
        <p v-if="hasNickname" class="lobby-as">
          {{ t.enterAsPrefix }} <strong>{{ nickname }}</strong>
        </p>
        <p v-else class="lobby-error">
          {{ t.needNickname }}
          —
          <NuxtLink to="/">главная</NuxtLink>
        </p>
        <p v-if="error" class="lobby-error">{{ error }}</p>

        <button
          type="submit"
          class="lobby-btn lobby-btn--primary"
          :disabled="busy || !hasNickname || !selectedSlot || roomFull"
        >
          {{ busy ? t.joining : joinAsLabel(nickname || '…', selectedSlot) }}
        </button>

        <nav class="lobby-nav">
          <NuxtLink to="/">{{ t.backHome }}</NuxtLink>
          <NuxtLink to="/lobbies">{{ t.backLobbies }}</NuxtLink>
        </nav>
      </form>
    </template>

    <template v-else>
      <header class="lobby-hero">
        <h2>{{ t.titlePrep }}</h2>
        <p v-if="playersLine" class="lobby-meta">{{ playersLine }}</p>
        <p class="lobby-hint">{{ t.prepHint }}</p>
      </header>

      <div v-if="slots.length" class="lobby-section">
        <h3 class="lobby-section-title">{{ t.pickSlotPrep }}</h3>
        <LobbySlotPicker
          :model-value="selectedSlot"
          :slots="slots"
          :current-player-id="currentPlayerId"
          :disabled="busy"
          @update:model-value="onSlotUpdate"
        />
      </div>

      <p v-if="error" class="lobby-error">{{ error }}</p>

      <div class="lobby-primary">
        <button
          v-if="isHost"
          type="button"
          class="lobby-btn lobby-btn--primary"
          :disabled="busy || !bootstrap?.playerCount"
          @click="emit('start')"
        >
          {{ busy ? t.starting : t.startGame }}
        </button>
        <p v-else class="lobby-waiting">{{ t.waitingHost }}</p>
      </div>

      <div class="lobby-secondary">
        <button
          type="button"
          class="lobby-more-toggle"
          :aria-expanded="moreOpen"
          @click="moreOpen = !moreOpen"
        >
          {{ moreOpen ? t.hideOptions : t.moreOptions }}
        </button>
        <div v-if="moreOpen" class="lobby-more">
          <button
            type="button"
            class="lobby-btn lobby-btn--secondary"
            :disabled="busy"
            @click="emit('copyInvite')"
          >
            {{ inviteCopied ? t.inviteCopied : t.copyInvite }}
          </button>
          <button
            v-if="isHost"
            type="button"
            class="lobby-btn lobby-btn--danger"
            :disabled="busy"
            @click="emit('close')"
          >
            {{ t.closeRoom }}
          </button>
          <SoundtrackPanel placement="lobby" />
        </div>
      </div>

      <nav class="lobby-nav">
        <NuxtLink to="/">{{ t.leaveHome }}</NuxtLink>
      </nav>
    </template>
  </div>
</template>

<style scoped>
.room-lobby {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.lobby-hero h2 {
  margin: 0 0 0.35rem;
  font-size: 1.15rem;
}
.lobby-meta {
  margin: 0;
  color: #94a3b8;
  font-size: 0.85rem;
}
.lobby-hint {
  margin: 0.55rem 0 0;
  color: #cbd5e1;
  font-size: 0.88rem;
  line-height: 1.45;
}
.lobby-section-title {
  margin: 0 0 0.45rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: #cbd5e1;
}
.lobby-as {
  margin: 0;
  color: #cbd5e1;
  font-size: 0.88rem;
}
.lobby-as strong {
  color: #f8fafc;
}
.lobby-error {
  margin: 0;
  color: #f87171;
  font-size: 0.85rem;
}
.lobby-primary {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.lobby-waiting {
  margin: 0;
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  border: 1px dashed #475569;
  background: rgba(15, 23, 42, 0.55);
  color: #cbd5e1;
  font-size: 0.9rem;
  text-align: center;
}
.lobby-btn {
  width: 100%;
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  border: 1px solid #2563eb;
  background: #1d4ed8;
  color: #fff;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}
.lobby-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.lobby-btn--primary {
  min-height: 2.75rem;
}
.lobby-btn--secondary {
  border-color: #64748b;
  background: #334155;
  font-weight: 500;
}
.lobby-btn--danger {
  border-color: #b91c1c;
  background: #7f1d1d;
}
.lobby-secondary {
  border-top: 1px solid #334155;
  padding-top: 0.55rem;
}
.lobby-more-toggle {
  width: 100%;
  padding: 0.4rem;
  border: none;
  background: transparent;
  color: #93c5fd;
  font-size: 0.85rem;
  cursor: pointer;
  text-align: left;
}
.lobby-more {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-top: 0.35rem;
}
.lobby-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
}
.lobby-nav a {
  color: #93c5fd;
  font-size: 0.85rem;
}

@media (max-width: 520px) {
  .lobby-hero h2 {
    font-size: 1.05rem;
  }
  .lobby-btn--primary {
    min-height: 3rem;
    font-size: 1rem;
  }
}
</style>
