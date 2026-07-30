<script setup lang="ts">
export interface LobbyPlayerSlot {
  id: string
  name: string
  color: string
  joined: boolean
  active?: boolean
  isYou?: boolean
}

const props = defineProps<{
  slots: LobbyPlayerSlot[]
  highlightId?: string | null
  compact?: boolean
}>()
</script>

<template>
  <ul class="player-list" :class="{ compact }">
    <li
      v-for="slot in slots"
      :key="slot.id"
      class="player-slot"
      :class="{
        joined: slot.joined,
        vacant: !slot.joined,
        highlight: highlightId === slot.id,
        active: slot.active,
        you: slot.isYou,
      }"
    >
      <span class="dot" :style="{ background: slot.color }" aria-hidden="true" />
      <span class="label">
        <strong>{{ slot.joined ? slot.name : 'Свободный слот' }}</strong>
        <span class="id">{{ slot.id }}</span>
      </span>
      <span class="status">
        <template v-if="slot.isYou">ваш слот</template>
        <template v-else-if="slot.joined && slot.active">на странице игры</template>
        <template v-else-if="slot.joined">в комнате</template>
        <template v-else>ожидаем</template>
      </span>
    </li>
  </ul>
</template>

<style scoped>
.player-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.player-slot {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  border: 1px solid #334155;
  background: #0f172a;
}
.player-slot.joined {
  border-color: #475569;
}
.player-slot.vacant {
  opacity: 0.72;
  border-style: dashed;
}
.player-slot.highlight {
  border-color: #60a5fa;
  box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.35);
}
.player-slot.active {
  border-color: #22c55e;
}
.player-slot.you {
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.25);
}
.dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  flex-shrink: 0;
}
.label {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.label strong {
  font-size: 0.88rem;
  font-weight: 600;
  color: #f1f5f9;
}
.id {
  font-size: 0.72rem;
  color: #64748b;
}
.status {
  font-size: 0.72rem;
  color: #94a3b8;
  white-space: nowrap;
}
.compact .player-slot {
  padding: 0.35rem 0.45rem;
}
.compact .label strong {
  font-size: 0.82rem;
}
</style>
