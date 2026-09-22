<script setup lang="ts">
import type { TurnQueueEntry } from '@galaxy/rules'
import { useUiStrings } from '~/i18n/ui-strings'

const props = withDefaults(
  defineProps<{
    /** Очередь текущего круга, уже в порядке хода */
    entries: TurnQueueEntry[]
    /** Локальный игрок — его строка помечена «вы» */
    myPlayerId?: string | null
    /** `strip` — компактная полоса над картой, `panel` — список в боковой панели */
    variant?: 'strip' | 'panel'
  }>(),
  {
    myPlayerId: null,
    variant: 'panel',
  },
)

const t = useUiStrings().turnOrder

function statusText(entry: TurnQueueEntry): string {
  if (entry.isActive) return t.active
  if (entry.hasMoved) return t.moved
  return t.waiting
}

function entryTitle(entry: TurnQueueEntry): string {
  const name = entry.playerId === props.myPlayerId ? `${entry.name} (${t.you})` : entry.name
  return t.entryTitle(entry.position, name, statusText(entry))
}
</script>

<template>
  <ol
    v-if="entries.length"
    class="turn-order"
    :class="variant === 'strip' ? 'turn-order--strip' : 'turn-order--panel'"
    :aria-label="t.heading"
  >
    <li
      v-for="entry in entries"
      :key="entry.playerId"
      class="turn-order-item"
      :class="{
        'turn-order-item--active': entry.isActive,
        'turn-order-item--moved': entry.hasMoved,
        'turn-order-item--you': entry.playerId === myPlayerId,
      }"
      :style="{ '--player-color': entry.color }"
      :title="entryTitle(entry)"
      :aria-current="entry.isActive ? 'true' : undefined"
    >
      <span class="turn-order-seat" aria-hidden="true">{{ entry.position }}</span>
      <span class="turn-order-name">{{ entry.name }}</span>
      <span v-if="entry.playerId === myPlayerId" class="turn-order-you">{{ t.you }}</span>
      <span v-if="variant === 'panel'" class="turn-order-status">{{ statusText(entry) }}</span>
      <span class="turn-order-sr">{{ entryTitle(entry) }}</span>
    </li>
  </ol>
</template>

<style scoped>
.turn-order {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  min-width: 0;
}

/* Подпись для читалок: на экране её заменяют номер, цвет и состояние */
.turn-order-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.turn-order-item {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  min-width: 0;
  border: 1px solid var(--g-border);
  background: var(--g-surface-glass-soft);
  color: var(--g-text-dim);
}

.turn-order-seat {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 1.3rem;
  height: 1.3rem;
  border-radius: var(--g-r-pill);
  border: 2px solid var(--player-color, var(--g-border-strong));
  background: color-mix(in srgb, var(--player-color, #64748b) 28%, transparent);
  font-size: var(--g-text-xs);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--g-text-strong);
}

.turn-order-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.turn-order-you {
  flex-shrink: 0;
  padding: 0 var(--g-s-1);
  border-radius: var(--g-r-sm);
  background: var(--g-accent-soft);
  font-size: var(--g-text-xs);
  color: var(--g-text);
}

/* Ходит сейчас: цвет игрока по рамке, текст в полную яркость */
.turn-order-item--active {
  border-color: var(--player-color, var(--g-accent));
  background: color-mix(in srgb, var(--player-color, #3b82f6) 22%, var(--g-surface-0));
  color: var(--g-text-strong);
  font-weight: 650;
}

/* Свой ход в этом круге игрок уже сделал */
.turn-order-item--moved {
  opacity: 0.55;
}

/* --- Полоса над картой ---------------------------------------------------- */
.turn-order--strip {
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--g-s-2);
}

.turn-order--strip .turn-order-item {
  /* Полоса лежит поверх карты. Сама фишка ловит наведение ради подсказки:
     на узком экране имя игрока видно только в ней */
  pointer-events: auto;
  padding: 0.15rem var(--g-s-2) 0.15rem 0.15rem;
  border-radius: var(--g-r-pill);
  font-size: var(--g-text-xs);
  max-width: 9rem;
}

.turn-order--strip .turn-order-item--active {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--player-color, #3b82f6) 45%, transparent);
}

/* --- Список в боковой панели ---------------------------------------------- */
.turn-order--panel {
  flex-direction: column;
  gap: var(--g-s-1);
}

.turn-order--panel .turn-order-item {
  padding: var(--g-s-1) var(--g-s-2);
  border-radius: var(--g-r-md);
  font-size: var(--g-text-sm);
}

.turn-order--panel .turn-order-name {
  flex: 1 1 auto;
}

.turn-order--panel .turn-order-status {
  flex-shrink: 0;
  font-size: var(--g-text-xs);
  color: var(--g-text-mute);
}

.turn-order--panel .turn-order-item--active .turn-order-status {
  color: var(--g-text);
}

@media (max-width: 900px) {
  /* На узком экране в полосе остаётся только номер в цвете игрока */
  .turn-order--strip .turn-order-name,
  .turn-order--strip .turn-order-you {
    display: none;
  }
  .turn-order--strip .turn-order-item {
    padding: 0.15rem;
    border-radius: var(--g-r-pill);
  }
}
</style>
