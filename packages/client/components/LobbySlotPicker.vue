<script setup lang="ts">
import type { LobbyPlayerSlot } from '~/components/LobbyPlayerList.vue'

const props = defineProps<{
  slots: LobbyPlayerSlot[]
  modelValue: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

function slotNumber(id: string): number {
  const m = /^player-(\d+)$/.exec(id)
  return m ? Number.parseInt(m[1], 10) : 0
}

function selectSlot(id: string) {
  if (props.disabled) return
  const slot = props.slots.find((s) => s.id === id)
  if (!slot || slot.joined) return
  emit('update:modelValue', id)
}
</script>

<template>
  <div class="slot-picker" role="radiogroup" aria-label="Выбор слота">
    <button
      v-for="slot in slots"
      :key="slot.id"
      type="button"
      class="slot-option"
      :class="{
        selected: modelValue === slot.id,
        occupied: slot.joined,
        vacant: !slot.joined,
      }"
      :disabled="disabled || slot.joined"
      :aria-checked="modelValue === slot.id"
      role="radio"
      @click="selectSlot(slot.id)"
    >
      <span class="dot" :style="{ background: slot.color }" aria-hidden="true" />
      <span class="slot-body">
        <span class="slot-title">
          Слот {{ slotNumber(slot.id) }}
          <strong>{{ slot.joined ? slot.name : 'Свободно' }}</strong>
        </span>
        <span class="slot-id">{{ slot.id }}</span>
      </span>
      <span class="slot-badge">
        {{ slot.joined ? 'занят' : modelValue === slot.id ? 'выбран' : 'свободен' }}
      </span>
    </button>
  </div>
</template>

<style scoped>
.slot-picker {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.slot-option {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.55rem;
  padding: 0.5rem 0.6rem;
  border-radius: 8px;
  border: 1px solid #334155;
  background: #0f172a;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.slot-option.vacant:hover:not(:disabled) {
  border-color: #60a5fa;
}
.slot-option.selected {
  border-color: #2563eb;
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.45);
  background: rgba(30, 58, 138, 0.35);
}
.slot-option.occupied {
  opacity: 0.65;
  border-style: dashed;
  cursor: not-allowed;
}
.slot-option:disabled {
  cursor: not-allowed;
}
.dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  flex-shrink: 0;
}
.slot-body {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.slot-title {
  font-size: 0.84rem;
  color: #cbd5e1;
}
.slot-title strong {
  display: block;
  font-size: 0.9rem;
  color: #f8fafc;
}
.slot-id {
  font-size: 0.72rem;
  color: #64748b;
}
.slot-badge {
  font-size: 0.72rem;
  color: #94a3b8;
  white-space: nowrap;
}
</style>
