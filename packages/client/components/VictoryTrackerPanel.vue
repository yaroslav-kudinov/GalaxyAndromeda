<script setup lang="ts">
import type { VictoryProgress, VictoryProgressEntry } from '@galaxy/rules'
import { useUiStrings } from '~/i18n/ui-strings'

const props = withDefaults(
  defineProps<{
    /** Счёт центров власти по игрокам — уже в порядке от лидера */
    progress: VictoryProgress
    /** Локальный игрок — его строка помечена «вы» */
    myPlayerId?: string | null
    /**
     * Сколько игровых ходов осталось до конца партии.
     * Заполнится, когда в ядре появится лимит ходов; пока не передаётся.
     */
    turnsLeft?: number | null
  }>(),
  {
    myPlayerId: null,
    turnsLeft: null,
  },
)

const t = useUiStrings().victory

function entryTitle(entry: VictoryProgressEntry): string {
  const name = entry.playerId === props.myPlayerId ? `${entry.name} (${t.you})` : entry.name
  if (entry.eliminated) return t.entryEliminatedTitle(name)
  if (entry.reached) return t.entryReachedTitle(name, entry.controlled)
  return t.entryTitle(name, entry.controlled, props.progress.needed, entry.remaining)
}

/** Доля закрашенной полосы: сколько из нужного уже взято */
function fillPercent(entry: VictoryProgressEntry): string {
  if (entry.eliminated || !props.progress.needed) return '0%'
  const share = Math.min(1, entry.controlled / props.progress.needed)
  return `${Math.round(share * 100)}%`
}
</script>

<template>
  <div v-if="progress.entries.length" class="victory">
    <p class="victory-goal">{{ t.goal(progress.needed, progress.total) }}</p>
    <p v-if="turnsLeft != null" class="victory-goal">{{ t.turnsLeft(turnsLeft) }}</p>

    <ul class="victory-list">
      <li
        v-for="entry in progress.entries"
        :key="entry.playerId"
        class="victory-row"
        :class="{
          'victory-row--reached': entry.reached && !entry.eliminated,
          'victory-row--out': entry.eliminated,
          'victory-row--you': entry.playerId === myPlayerId,
        }"
        :style="{ '--player-color': entry.color }"
        :title="entryTitle(entry)"
      >
        <span class="victory-fill" :style="{ width: fillPercent(entry) }" aria-hidden="true" />
        <span class="victory-swatch" aria-hidden="true" />
        <span class="victory-name">{{ entry.name }}</span>
        <span v-if="entry.playerId === myPlayerId" class="victory-you">{{ t.you }}</span>
        <span v-if="!entry.eliminated" class="victory-score">
          {{ t.score(entry.controlled, progress.needed) }}
        </span>
        <span class="victory-left">
          <template v-if="entry.eliminated">{{ t.eliminatedShort }}</template>
          <template v-else-if="entry.reached">{{ t.reachedShort }}</template>
          <template v-else>{{ t.left(entry.remaining) }}</template>
        </span>
        <span class="victory-sr">{{ entryTitle(entry) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.victory-goal {
  margin: 0 0 var(--g-s-2);
  font-size: var(--g-text-xs);
  line-height: 1.4;
  color: var(--g-text-dim);
}

.victory-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.victory-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  overflow: hidden;
  padding: var(--g-s-1) var(--g-s-2);
  border: 1px solid var(--g-border);
  border-radius: var(--g-r-md);
  background: var(--g-surface-glass-soft);
  font-size: var(--g-text-sm);
  color: var(--g-text);
}

/* Полоса прогресса — фон строки, а не отдельный элемент рядом */
.victory-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: color-mix(in srgb, var(--player-color, #3b82f6) 24%, transparent);
  transition: width 0.25s ease;
}

.victory-row > *:not(.victory-fill) {
  position: relative;
}

.victory-swatch {
  flex-shrink: 0;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: var(--g-r-pill);
  border: 1px solid rgba(15, 23, 42, 0.55);
  background: var(--player-color, var(--g-text-mute));
}

.victory-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.victory-you {
  flex-shrink: 0;
  padding: 0 var(--g-s-1);
  border-radius: var(--g-r-sm);
  background: var(--g-accent-soft);
  font-size: var(--g-text-xs);
}

.victory-score {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  color: var(--g-text-strong);
}

.victory-left {
  flex-shrink: 0;
  min-width: 3.5rem;
  text-align: right;
  font-size: var(--g-text-xs);
  color: var(--g-text-mute);
}

/* Порог взят: партия вот-вот закончится, строку видно сразу */
.victory-row--reached {
  border-color: var(--g-ok);
}
.victory-row--reached .victory-left {
  color: var(--g-ok);
}

.victory-row--out {
  opacity: 0.5;
}
.victory-row--out .victory-name {
  text-decoration: line-through;
}

/* Подпись для читалок: на экране её заменяют полоса, счёт и цвет */
.victory-sr {
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
</style>
