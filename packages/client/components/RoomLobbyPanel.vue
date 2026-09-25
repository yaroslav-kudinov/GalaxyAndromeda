<script setup lang="ts">
import type { BotDifficulty } from '@galaxy/rules'
import { BOT_DIFFICULTIES } from '@galaxy/rules'
import type { LobbyPlayerSlot } from '~/components/LobbyPlayerList.vue'
import type { RoomBootstrap } from '~/composables/useGameApi'
import { PLAYER_LABELS, slotFromPlayerId } from '@galaxy/rules'
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
  addBot: [slotId: string]
  removeBot: [slotId: string]
  botDifficulty: [slotId: string, difficulty: BotDifficulty]
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

/** Места, которыми хозяин распоряжается: свободные и занятые ботами. */
const botSeats = computed(() =>
  props.slots.filter((slot) => slot.id !== props.currentPlayerId && (!slot.joined || slot.bot)),
)

function seatColor(id: string): string {
  const n = slotFromPlayerId(id)
  return (n != null ? PLAYER_LABELS[n] : null) ?? id
}

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

      <div v-if="isHost && botSeats.length" class="lobby-section">
        <h3 class="lobby-section-title">{{ t.botsTitle }}</h3>
        <p class="lobby-bots-hint">{{ t.botsHint }}</p>
        <ul class="bot-seats">
          <li v-for="slot in botSeats" :key="slot.id" class="bot-seat" :class="{ taken: slot.joined }">
            <span class="bot-dot" :style="{ background: slot.color }" aria-hidden="true" />
            <span class="bot-seat-label">
              <strong>{{ seatColor(slot.id) }}</strong>
              · {{ slot.joined ? slot.name : t.freeSeat }}
            </span>
            <span v-if="slot.joined" class="bot-levels" role="radiogroup" :aria-label="t.botLevelLabel">
              <button
                v-for="level in BOT_DIFFICULTIES"
                :key="level"
                type="button"
                role="radio"
                class="bot-level"
                :class="{ 'bot-level--on': (slot.botDifficulty ?? 'medium') === level }"
                :aria-checked="(slot.botDifficulty ?? 'medium') === level"
                :title="t.botLevelHint[level]"
                :disabled="busy"
                @click="emit('botDifficulty', slot.id, level)"
              >
                {{ t.botLevel[level] }}
              </button>
            </span>
            <button
              v-if="slot.joined"
              type="button"
              class="bot-seat-btn"
              :disabled="busy"
              @click="emit('removeBot', slot.id)"
            >
              {{ t.removeBot }}
            </button>
            <button
              v-else
              type="button"
              class="bot-seat-btn bot-seat-btn--add"
              :disabled="busy"
              @click="emit('addBot', slot.id)"
            >
              {{ t.addBot }}
            </button>
          </li>
        </ul>
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
.lobby-bots-hint {
  margin: 0 0 0.45rem;
  color: #94a3b8;
  font-size: 0.8rem;
  line-height: 1.4;
}
.bot-seats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.bot-seat {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 8px;
  border: 1px dashed #334155;
  background: #0f172a;
  font-size: 0.85rem;
  color: #cbd5e1;
}
.bot-seat.taken {
  border-style: solid;
  border-color: #475569;
}
.bot-dot {
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.9);
}
.bot-seat-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bot-levels {
  display: inline-flex;
  border: 1px solid #475569;
  border-radius: 6px;
  overflow: hidden;
}
.bot-level {
  padding: 0.25rem 0.45rem;
  border: none;
  background: #0f172a;
  color: #94a3b8;
  font-size: 0.74rem;
  cursor: pointer;
}
.bot-level + .bot-level {
  border-left: 1px solid #334155;
}
.bot-level--on {
  background: #1e3a8a;
  color: #f8fafc;
  font-weight: 600;
}
.bot-level:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
@media (max-width: 520px) {
  .bot-seat {
    grid-template-columns: auto 1fr;
  }
  .bot-levels,
  .bot-seat-btn {
    grid-column: 1 / -1;
    justify-self: start;
  }
}
.bot-seat-btn {
  padding: 0.3rem 0.6rem;
  border-radius: 6px;
  border: 1px solid #64748b;
  background: #334155;
  color: #f8fafc;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
}
.bot-seat-btn--add {
  border-color: #2563eb;
  background: #1e3a8a;
}
.bot-seat-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
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
