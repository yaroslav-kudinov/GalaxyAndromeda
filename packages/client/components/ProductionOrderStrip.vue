<script setup lang="ts">
import type { ShipType } from '@galaxy/rules'
import { SHIP_LABELS } from '@galaxy/rules'
import type { ProductionOrderSlot } from '~/utils/production-order-slots'

const props = withDefaults(
  defineProps<{
    slots: ProductionOrderSlot[]
    playerColor: string
    pulseUnplaced?: boolean
    pulsePlaced?: boolean
  }>(),
  {
    pulseUnplaced: false,
    pulsePlaced: false,
  },
)

const emit = defineEmits<{
  select: [index: number]
}>()

function slotTitle(slot: ProductionOrderSlot): string {
  const name = SHIP_LABELS[slot.type as ShipType]
  if (slot.placed && slot.coord) {
    return `${name} на клетке (${slot.coord.q}, ${slot.coord.r}). Щелчок — убрать этот и следующие.`
  }
  if (slot.active) return `${name} — щёлкните клетку региона`
  return `${name} — ещё не размещён`
}

function onSelect(slot: ProductionOrderSlot) {
  if (!slot.placed) return
  emit('select', slot.index)
}
</script>

<template>
  <ul class="order-strip" aria-label="Корабли в заявке">
    <li v-for="slot in slots" :key="slot.index">
      <button
        type="button"
        class="order-slot"
        :class="{
          'order-slot--placed': slot.placed && !pulsePlaced,
          'order-slot--active': slot.active,
          'order-slot--pending': !slot.placed && !slot.active,
          'order-slot--pulse-unplaced': pulseUnplaced && !slot.placed,
          'order-slot--pulse-placed': pulsePlaced && slot.placed,
        }"
        :disabled="!slot.placed || pulsePlaced"
        :title="slotTitle(slot)"
        :aria-label="slotTitle(slot)"
        @click="onSelect(slot)"
      >
        <svg width="26" height="26" viewBox="-14 -14 28 28" aria-hidden="true">
          <g
            class="order-slot-glyph"
            :class="{
              'order-slot-glyph--pulse-unplaced': pulseUnplaced && !slot.placed,
              'order-slot-glyph--pulse-placed': pulsePlaced && slot.placed,
            }"
          >
            <ShipGlyph
              :type="slot.type"
              :player-color="playerColor"
              :scale="0.78"
            />
          </g>
        </svg>
        <span v-if="slot.placed" class="order-slot-check" aria-hidden="true">✓</span>
      </button>
    </li>
  </ul>
</template>

<style scoped>
.order-strip {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.35rem;
}
.order-slot {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.35rem;
  height: 2.35rem;
  padding: 0;
  border-radius: 8px;
  border: 1px solid rgba(244, 114, 182, 0.45);
  background: rgba(30, 41, 59, 0.75);
  cursor: pointer;
}
.order-slot:disabled {
  cursor: default;
}
.order-slot--placed {
  border-color: rgba(148, 163, 184, 0.55);
  background: rgba(15, 23, 42, 0.7);
  opacity: 0.55;
}
.order-slot--placed:not(:disabled):hover {
  opacity: 0.85;
  border-color: #f9a8d4;
}
.order-slot--active {
  border-color: #f9a8d4;
  background: rgba(190, 24, 93, 0.35);
  box-shadow: 0 0 0 2px rgba(244, 114, 182, 0.35);
}
.order-slot--pending {
  border-color: rgba(244, 114, 182, 0.7);
}
.order-slot-check {
  position: absolute;
  right: 1px;
  bottom: 0;
  font-size: 0.72rem;
  font-weight: 800;
  color: #86efac;
  text-shadow: 0 0 4px #052e16;
  pointer-events: none;
}
.order-slot-glyph {
  transform-box: fill-box;
  transform-origin: center;
}
.order-slot-glyph--pulse-unplaced,
.order-slot--pulse-unplaced {
  animation: order-slot-pulse 1.05s ease-in-out infinite;
}
.order-slot-glyph--pulse-placed {
  animation: order-slot-grow-shrink 0.7s ease-in-out 2;
}
@keyframes order-slot-pulse {
  0%,
  100% {
    transform: scale(1);
    filter: none;
  }
  50% {
    transform: scale(1.16);
    filter: drop-shadow(0 0 4px rgba(249, 168, 212, 0.85));
  }
}
@keyframes order-slot-grow-shrink {
  0%,
  100% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.32);
  }
  70% {
    transform: scale(0.9);
  }
}
</style>
