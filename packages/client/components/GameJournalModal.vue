<script setup lang="ts">
import type { GameEvent, HexCoord } from '@galaxy/rules'
import { useUiStrings } from '~/i18n/ui-strings'
import { buildGameJournal, type JournalPlayer } from '~/utils/game-journal'

const props = defineProps<{
  events: readonly GameEvent[]
  players: readonly JournalPlayer[]
}>()

const emit = defineEmits<{
  close: []
  focusCell: [coord: HexCoord]
}>()

const t = useUiStrings().journal
/** '' — все игроки */
const onlyPlayer = ref('')

const journal = computed(() => buildGameJournal(props.events, props.players))
const playerById = computed(() => new Map(props.players.map((player) => [player.id, player])))

/** Фильтр по игроку: его ходы и общие события, где он упомянут по имени. */
const shown = computed(() => {
  const id = onlyPlayer.value
  if (!id) return journal.value
  const name = playerById.value.get(id)?.name ?? ''
  return journal.value
    .map((turn) => ({
      ...turn,
      entries: turn.entries.filter((entry) => entry.actorId === id || (!entry.actorId && name && entry.text.includes(name))),
    }))
    .filter((turn) => turn.entries.length > 0)
})

/** Текст с кликабельными координатами: «(2,-3)» показывает клетку на карте. */
function parts(text: string): { text: string; coord?: HexCoord }[] {
  const out: { text: string; coord?: HexCoord }[] = []
  let last = 0
  for (const match of text.matchAll(/\((-?\d+),\s*(-?\d+)\)/g)) {
    const at = match.index ?? 0
    if (at > last) out.push({ text: text.slice(last, at) })
    out.push({ text: match[0], coord: { q: Number(match[1]), r: Number(match[2]) } })
    last = at + match[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

function focus(coord: HexCoord) {
  emit('focusCell', coord)
  emit('close')
}
</script>

<template>
  <div class="journal-backdrop" role="presentation" @click.self="emit('close')">
    <section class="journal" role="dialog" aria-modal="true" aria-labelledby="journal-title">
      <header class="journal-head">
        <h2 id="journal-title">{{ t.title }}</h2>
        <label class="journal-filter">
          <span>{{ t.filter }}</span>
          <select v-model="onlyPlayer">
            <option value="">{{ t.everyone }}</option>
            <option v-for="player in players" :key="player.id" :value="player.id">{{ player.name }}</option>
          </select>
        </label>
        <button type="button" class="journal-close" :aria-label="t.close" @click="emit('close')">×</button>
      </header>
      <p class="journal-hint">{{ t.hint }}</p>

      <div class="journal-body">
        <p v-if="!shown.length" class="journal-empty">{{ t.empty }}</p>
        <section v-for="turn in shown" :key="turn.turn" class="journal-turn">
          <h3>{{ t.turn(turn.turn) }}</h3>
          <ul>
            <li v-for="entry in turn.entries" :key="entry.id" :class="{ 'journal-entry--minor': entry.minor }">
              <strong
                v-if="entry.actorId"
                class="journal-actor"
                :style="{ color: playerById.get(entry.actorId)?.color }"
              >{{ playerById.get(entry.actorId)?.name ?? entry.actorId }}</strong>
              <template v-for="(part, index) in parts(entry.text)" :key="index">
                <button
                  v-if="part.coord"
                  type="button"
                  class="journal-coord"
                  :title="t.showCell"
                  @click="focus(part.coord)"
                >{{ part.text }}</button>
                <span v-else>{{ part.text }}</span>
              </template>
            </li>
          </ul>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.journal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 235;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(2, 6, 23, 0.7);
}
.journal {
  width: min(40rem, 100%);
  max-height: min(80dvh, 44rem);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid #334155;
  background: #0f172a;
  color: #e2e8f0;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.5);
}
.journal-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.75rem 1rem 0.25rem;
}
.journal-head h2 {
  margin: 0;
  font-size: 1.1rem;
  flex: 1 1 auto;
}
.journal-filter {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: #94a3b8;
}
.journal-filter select {
  background: #1e293b;
  color: #e2e8f0;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 0.2rem 0.4rem;
}
.journal-close {
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 1.4rem;
  cursor: pointer;
}
.journal-hint {
  margin: 0;
  padding: 0 1rem 0.5rem;
  font-size: 0.8rem;
  color: #94a3b8;
}
.journal-body {
  overflow-y: auto;
  padding: 0 1rem 1rem;
}
.journal-turn h3 {
  position: sticky;
  top: 0;
  margin: 0.6rem 0 0.3rem;
  padding: 0.2rem 0;
  font-size: 0.9rem;
  color: #fbbf24;
  background: #0f172a;
}
.journal-turn ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.journal-turn li {
  padding: 0.25rem 0;
  border-bottom: 1px solid rgba(51, 65, 85, 0.5);
  font-size: 0.88rem;
  line-height: 1.4;
}
.journal-entry--minor {
  color: #64748b;
}
.journal-actor {
  margin-right: 0.35rem;
}
.journal-actor::after {
  content: ':';
}
.journal-coord {
  padding: 0;
  border: none;
  background: none;
  color: #93c5fd;
  text-decoration: underline dotted;
  cursor: pointer;
  font: inherit;
}
.journal-empty {
  color: #94a3b8;
}
</style>
