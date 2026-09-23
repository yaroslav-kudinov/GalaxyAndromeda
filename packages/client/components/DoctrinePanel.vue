<script setup lang="ts">
import type { DoctrineId, GameSnapshot } from '@galaxy/rules'
import {
  activeDoctrineId,
  doctrineChoiceOwed,
  doctrineDefinition,
  doctrinesEnabled,
  doctrineWindowStart,
  DOCTRINES,
} from '@galaxy/rules'
import { useUiStrings } from '~/i18n/ui-strings'

const props = defineProps<{
  snapshot: GameSnapshot
  playerId: string
  busy?: boolean
  /** Строка бюджета перезарядки — живёт в этом же блоке боковой панели. */
  rechargeBanner?: string | null
}>()

const emit = defineEmits<{
  choose: [doctrineId: DoctrineId]
}>()

const t = useUiStrings().doctrines

const enabled = computed(() => doctrinesEnabled(props.snapshot))
const windowFrom = computed(() => doctrineWindowStart(props.snapshot))
const windowTo = computed(() => windowFrom.value + (props.snapshot.doctrineWindow ?? 1) - 1)
const owed = computed(() => doctrineChoiceOwed(props.snapshot, props.playerId))
const choice = computed(() => props.snapshot.doctrineChoice)
const myPendingPick = computed(() => choice.value?.picks[props.playerId] ?? null)

const participants = computed(() => {
  const ids = props.snapshot.participatingPlayerIds
  return props.snapshot.players.filter(
    (player) => !player.eliminated && (!ids?.length || ids.includes(player.id)),
  )
})

const waitingNames = computed(() => {
  const c = choice.value
  if (!c) return ''
  const picked = new Set([...Object.keys(c.picks), ...(c.pickedBy ?? [])])
  return participants.value
    .filter((player) => !picked.has(player.id))
    .map((player) => player.name)
    .join(', ')
})

const activeRows = computed(() =>
  participants.value.map((player) => {
    const id = activeDoctrineId(props.snapshot, player.id)
    return {
      playerId: player.id,
      name: player.id === props.playerId ? `${player.name} (${t.you})` : player.name,
      color: player.color,
      label: id === 'none' ? t.notChosen : doctrineDefinition(id).name,
    }
  }),
)

const nextChoiceTurn = computed(() => windowTo.value + 1)
const showNextChoice = computed(() => {
  const limit = props.snapshot.turnLimit
  return !choice.value && (limit == null || nextChoiceTurn.value <= limit)
})
</script>

<template>
  <section v-if="enabled || rechargeBanner" class="doctrines">
    <ResourceRechargeBanner v-if="rechargeBanner" :text="rechargeBanner" variant="panel" />

    <template v-if="enabled">
      <header class="doctrines-head">
        <h3 class="doctrines-heading">{{ t.heading }}</h3>
        <span class="doctrines-window">{{ t.windowLabel(windowFrom, windowTo) }}</span>
      </header>

      <template v-if="owed">
        <p class="doctrines-prompt">{{ t.choosePrompt }}</p>
        <ul class="doctrine-options">
          <li v-for="doctrine in DOCTRINES" :key="doctrine.id" class="doctrine-option">
            <div class="doctrine-text">
              <strong>{{ doctrine.name }}</strong>
              <span class="doctrine-line"><em>{{ t.gives }}:</em> {{ doctrine.gives }}</span>
              <span class="doctrine-line"><em>{{ t.costs }}:</em> {{ doctrine.costs }}</span>
            </div>
            <button
              type="button"
              class="doctrine-choose"
              :disabled="busy"
              @click="emit('choose', doctrine.id)"
            >
              {{ busy ? t.choosing : t.choose }}
            </button>
          </li>
        </ul>
      </template>

      <template v-else-if="choice">
        <p v-if="myPendingPick" class="doctrines-prompt">
          {{ t.yourPick(doctrineDefinition(myPendingPick).name) }}
        </p>
        <p v-if="waitingNames" class="doctrines-waiting">{{ t.waitingFor(waitingNames) }}</p>
      </template>

      <template v-else>
        <p class="doctrines-subheading">{{ t.activeTitle }}</p>
        <ul class="doctrine-active">
          <li v-for="row in activeRows" :key="row.playerId">
            <span class="doctrine-swatch" :style="{ background: row.color }" aria-hidden="true" />
            <span class="doctrine-player">{{ row.name }}</span>
            <span class="doctrine-name">{{ row.label }}</span>
          </li>
        </ul>
        <p class="doctrines-note">{{ t.untilTurn(windowTo) }}</p>
        <p v-if="showNextChoice" class="doctrines-note">{{ t.nextChoice(nextChoiceTurn) }}</p>
      </template>
    </template>
  </section>
</template>

<style scoped>
.doctrines {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.doctrines-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.doctrines-heading {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #c4b5fd;
}
.doctrines-window {
  font-size: 0.72rem;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}
.doctrines-prompt,
.doctrines-waiting,
.doctrines-note,
.doctrines-subheading {
  margin: 0;
  font-size: 0.78rem;
  color: #cbd5e1;
}
.doctrines-waiting,
.doctrines-note {
  color: #94a3b8;
}
.doctrine-options,
.doctrine-active {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.doctrine-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border-radius: 8px;
  border: 1px solid rgba(167, 139, 250, 0.35);
  background: rgba(46, 16, 101, 0.35);
}
.doctrine-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  flex: 1;
  min-width: 0;
  font-size: 0.74rem;
  color: #e2e8f0;
}
.doctrine-line em {
  font-style: normal;
  color: #a5b4fc;
}
.doctrine-choose {
  flex-shrink: 0;
  padding: 0.3rem 0.65rem;
  border-radius: 6px;
  border: 1px solid rgba(167, 139, 250, 0.7);
  background: rgba(109, 40, 217, 0.55);
  color: #f5f3ff;
  font-weight: 600;
  font-size: 0.75rem;
  cursor: pointer;
}
.doctrine-choose:disabled {
  opacity: 0.5;
  cursor: default;
}
.doctrine-active li {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: #e2e8f0;
}
.doctrine-swatch {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
}
.doctrine-player {
  flex: 1;
  min-width: 0;
}
.doctrine-name {
  color: #c4b5fd;
  font-weight: 600;
}
</style>
