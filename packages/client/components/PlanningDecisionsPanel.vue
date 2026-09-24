<script setup lang="ts">
/**
 * Обязательные решения планирования в карточке над картой — строго по одному, в порядке
 * правил (`planningStepFor`): потери гарнизона в осаде, доктрина, клетки захвата, фишки
 * перезарядки. Пока решения не приняты, маркеры не ставятся и ход не передаётся.
 */
import type { DoctrineId, GameSnapshot, HexCoord, ResourceTokenRef, ShipUnit } from '@galaxy/rules'
import {
  claimPicksRemaining,
  DOCTRINES,
  eligibleClaimCells,
  planningStepFor,
  rechargePicksRemaining,
  SHIP_LABELS,
  siegeLossesOwedBy,
  type PlanningStep,
} from '@galaxy/rules'
import { useUiStrings } from '~/i18n/ui-strings'

const props = defineProps<{
  snapshot: GameSnapshot
  playerId: string
  busy?: boolean
}>()

const emit = defineEmits<{
  doctrine: [doctrineId: DoctrineId]
  claims: [picks: HexCoord[]]
  recharge: [picks: ResourceTokenRef[]]
  siegeLosses: [shipIds: string[]]
  focusCell: [coord: HexCoord]
}>()

const t = useUiStrings().planningDecisions

const keyOf = (coord: HexCoord) => `${coord.q},${coord.r}`

const step = computed(() => planningStepFor(props.snapshot, props.playerId))

/** Шаги по порядку; осада показывается, только когда она есть. */
const steps = computed(() => {
  const order: PlanningStep[] = ['doctrine', 'claims', 'recharge', 'markers']
  return step.value === 'siege-losses' ? (['siege-losses', ...order] as PlanningStep[]) : order
})
const stepIndex = computed(() => steps.value.indexOf(step.value === 'doctrine-wait' ? 'doctrine' : step.value))

/** Сколько игроков уже выбрали доктрину — пока ждём остальных. */
const doctrinePickedCount = computed(() => props.snapshot.doctrineChoice?.pickedBy?.length ?? 0)
const doctrineParticipants = computed(
  () => props.snapshot.participatingPlayerIds?.length
    || props.snapshot.players.filter((player) => !player.eliminated).length,
)

const claimsOwed = computed(() => claimPicksRemaining(props.snapshot, props.playerId))
const claimCandidates = computed(() => eligibleClaimCells(props.snapshot, props.playerId))
const claimNeed = computed(() => Math.min(claimsOwed.value, claimCandidates.value.length))
/** Выбранные клетки захвата — у страницы, чтобы карта подсвечивала и принимала щелчки. */
const claimSelected = defineModel<string[]>('claimSelected', { default: () => [] })

const rechargeOwed = computed(() => rechargePicksRemaining(props.snapshot, props.playerId))
const faceDownTokens = computed(() => {
  const out: { ref: ResourceTokenRef; key: string; type: string; value: number }[] = []
  for (const cell of props.snapshot.cells) {
    if (cell.controlOwnerId !== props.playerId) continue
    cell.resourceTokens.forEach((token, tokenIndex) => {
      if (token.faceUp !== false) return
      out.push({
        ref: { coord: { ...cell.coord }, tokenIndex },
        key: `${keyOf(cell.coord)}:${tokenIndex}`,
        type: token.type,
        value: token.value,
      })
    })
  }
  return out.sort((a, b) => b.value - a.value)
})
const rechargeNeed = computed(() => Math.min(rechargeOwed.value, faceDownTokens.value.length))
/** Выбранные фишки перезарядки — у страницы, чтобы их можно было отмечать и на карте. */
const rechargeSelected = defineModel<string[]>('rechargeSelected', { default: () => [] })

const siegeCells = computed(() => siegeLossesOwedBy(props.snapshot, props.playerId))
const garrisonOf = (key: string): ShipUnit[] =>
  props.snapshot.cells
    .find((cell) => keyOf(cell.coord) === key)
    ?.ships.filter((ship) => ship.ownerId === props.playerId) ?? []
const siegeChoice = ref<Record<string, string>>({})

// Новый долг — чистый выбор.
watch(() => `${props.snapshot.turnNumber}:${claimsOwed.value}`, () => { claimSelected.value = [] })
watch(() => `${props.snapshot.turnNumber}:${rechargeOwed.value}`, () => { rechargeSelected.value = [] })
watch(() => `${props.snapshot.turnNumber}:${siegeCells.value.join('|')}`, () => { siegeChoice.value = {} })

const visible = computed(() => step.value !== 'markers')

function toggle(list: string[], key: string, limit: number): string[] {
  if (list.includes(key)) return list.filter((entry) => entry !== key)
  if (list.length >= limit) return list
  return [...list, key]
}

function toggleClaim(coord: HexCoord) {
  claimSelected.value = toggle(claimSelected.value, keyOf(coord), claimNeed.value)
  emit('focusCell', coord)
}

function toggleToken(key: string, coord: HexCoord) {
  rechargeSelected.value = toggle(rechargeSelected.value, key, rechargeNeed.value)
  emit('focusCell', coord)
}

function submitClaims() {
  const picks = claimCandidates.value
    .filter((cell) => claimSelected.value.includes(keyOf(cell.coord)))
    .map((cell) => ({ ...cell.coord }))
  emit('claims', picks)
}

function submitRecharge() {
  emit('recharge', faceDownTokens.value.filter((token) => rechargeSelected.value.includes(token.key)).map((token) => token.ref))
}

function submitSiege() {
  emit('siegeLosses', siegeCells.value.map((key) => siegeChoice.value[key]!).filter(Boolean))
}

function tokenLabel(type: string, value: number): string {
  return type === 'credits' ? t.credits(value) : t.production(value)
}

function cellTokens(coord: HexCoord): string {
  const cell = props.snapshot.cells.find((candidate) => keyOf(candidate.coord) === keyOf(coord))
  return cell?.resourceTokens.map((token) => tokenLabel(token.type, token.value)).join(', ') ?? ''
}
</script>

<template>
  <section v-if="visible" class="pd" role="dialog" :aria-label="t.heading">
    <header class="pd-head">
      <strong>{{ t.heading }}</strong>
      <span class="pd-sub">{{ t.sub }}</span>
      <ol class="pd-steps" :aria-label="t.stepsLabel">
        <li
          v-for="(entry, index) in steps"
          :key="entry"
          :class="{ 'pd-step--done': index < stepIndex, 'pd-step--now': index === stepIndex }"
          :aria-current="index === stepIndex ? 'step' : undefined"
        >
          {{ t.stepNames[entry] }}
        </li>
      </ol>
    </header>

    <!-- Ждём доктрины соперников -->
    <div v-if="step === 'doctrine-wait'" class="pd-block">
      <p class="pd-title">{{ t.doctrineWait(doctrinePickedCount, doctrineParticipants) }}</p>
    </div>

    <!-- Доктрина -->
    <div v-if="step === 'doctrine'" class="pd-block">
      <p class="pd-title">{{ t.doctrineTitle }}</p>
      <div class="pd-doctrines">
        <button
          v-for="doctrine in DOCTRINES"
          :key="doctrine.id"
          type="button"
          class="pd-doctrine"
          :disabled="busy"
          @click="emit('doctrine', doctrine.id)"
        >
          <strong>{{ doctrine.name }}</strong>
          <span v-if="doctrine.id !== 'none'" class="pd-gives">{{ doctrine.gives }}</span>
          <span v-if="doctrine.id !== 'none'" class="pd-costs">{{ t.costs }}: {{ doctrine.costs }}</span>
        </button>
      </div>
    </div>

    <!-- Захват -->
    <div v-if="step === 'claims'" class="pd-block">
      <p class="pd-title">{{ t.claimsTitle(claimNeed, claimCandidates.length) }}</p>
      <ul class="pd-list">
        <li v-for="cell in claimCandidates" :key="keyOf(cell.coord)">
          <label class="pd-row" :class="{ 'pd-row--on': claimSelected.includes(keyOf(cell.coord)) }">
            <input
              type="checkbox"
              :checked="claimSelected.includes(keyOf(cell.coord))"
              :disabled="busy || (!claimSelected.includes(keyOf(cell.coord)) && claimSelected.length >= claimNeed)"
              @change="toggleClaim(cell.coord)"
            >
            <span class="pd-coord">({{ cell.coord.q }}, {{ cell.coord.r }})</span>
            <span v-if="cell.isPowerCenter" class="pd-star">★ {{ t.powerCenter }}</span>
            <span class="pd-muted">{{ cellTokens(cell.coord) || t.noTokens }}</span>
          </label>
        </li>
      </ul>
      <button
        type="button"
        class="pd-confirm"
        :disabled="busy || claimSelected.length !== claimNeed"
        @click="submitClaims"
      >
        {{ t.claimsConfirm(claimSelected.length, claimNeed) }}
      </button>
    </div>

    <!-- Перезарядка -->
    <div v-if="step === 'recharge'" class="pd-block">
      <p class="pd-title">{{ t.rechargeTitle(rechargeNeed, faceDownTokens.length) }}</p>
      <ul class="pd-list">
        <li v-for="token in faceDownTokens" :key="token.key">
          <label class="pd-row" :class="{ 'pd-row--on': rechargeSelected.includes(token.key) }">
            <input
              type="checkbox"
              :checked="rechargeSelected.includes(token.key)"
              :disabled="busy || (!rechargeSelected.includes(token.key) && rechargeSelected.length >= rechargeNeed)"
              @change="toggleToken(token.key, token.ref.coord)"
            >
            <span class="pd-token" :class="`pd-token--${token.type}`">{{ tokenLabel(token.type, token.value) }}</span>
            <span class="pd-coord">({{ token.ref.coord.q }}, {{ token.ref.coord.r }})</span>
          </label>
        </li>
      </ul>
      <button
        type="button"
        class="pd-confirm"
        :disabled="busy || rechargeSelected.length !== rechargeNeed"
        @click="submitRecharge"
      >
        {{ t.rechargeConfirm(rechargeSelected.length, rechargeNeed) }}
      </button>
    </div>

    <!-- Осада -->
    <div v-if="step === 'siege-losses'" class="pd-block">
      <p class="pd-title">{{ t.siegeTitle }}</p>
      <div v-for="key in siegeCells" :key="key" class="pd-siege">
        <span class="pd-coord">({{ key }})</span>
        <label v-for="ship in garrisonOf(key)" :key="ship.id" class="pd-row" :class="{ 'pd-row--on': siegeChoice[key] === ship.id }">
          <input
            type="radio"
            :name="`siege-${key}`"
            :checked="siegeChoice[key] === ship.id"
            :disabled="busy"
            @change="siegeChoice = { ...siegeChoice, [key]: ship.id }"
          >
          {{ SHIP_LABELS[ship.type] }}
        </label>
      </div>
      <button
        type="button"
        class="pd-confirm"
        :disabled="busy || siegeCells.some((key) => !siegeChoice[key])"
        @click="submitSiege"
      >
        {{ t.siegeConfirm }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.pd {
  position: absolute;
  top: calc(var(--hud-header-height, 3rem) + 0.5rem);
  left: 50%;
  transform: translateX(-50%);
  z-index: 55;
  width: min(92vw, 560px);
  max-height: 70vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem 0.9rem;
  border-radius: 12px;
  border: 1px solid rgba(251, 191, 36, 0.6);
  background: rgba(15, 23, 42, 0.96);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  color: #e2e8f0;
}
.pd-head {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.pd-head strong {
  font-size: 1rem;
  color: #fcd34d;
}
.pd-sub {
  font-size: 0.75rem;
  color: #94a3b8;
}
.pd-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.9rem;
  margin: 0.3rem 0 0;
  padding: 0;
  list-style: none;
  counter-reset: pd-step;
  font-size: 0.72rem;
  color: #64748b;
}
.pd-steps li {
  counter-increment: pd-step;
}
.pd-steps li::before {
  content: counter(pd-step) '. ';
}
.pd-step--done {
  color: #86efac;
}
.pd-step--now {
  color: #fcd34d;
  font-weight: 700;
}
.pd-block {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(148, 163, 184, 0.25);
}
.pd-title {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
}
.pd-doctrines {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.35rem;
}
.pd-doctrine {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  background: rgba(30, 41, 59, 0.8);
  color: inherit;
  text-align: left;
  font-size: 0.72rem;
  cursor: pointer;
}
.pd-doctrine:hover:not(:disabled) {
  border-color: #fcd34d;
}
.pd-doctrine strong {
  font-size: 0.82rem;
}
.pd-gives {
  color: #86efac;
}
.pd-costs {
  color: #fca5a5;
}
.pd-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.pd-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.4rem;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
}
.pd-row--on {
  background: rgba(251, 191, 36, 0.14);
}
.pd-coord {
  font-variant-numeric: tabular-nums;
  color: #cbd5e1;
}
.pd-star {
  color: #fcd34d;
  font-weight: 600;
}
.pd-muted {
  color: #94a3b8;
  font-size: 0.72rem;
}
.pd-token {
  min-width: 5.5rem;
  font-weight: 600;
}
.pd-token--credits {
  color: #facc15;
}
.pd-token--production {
  color: #fb923c;
}
.pd-siege {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
}
.pd-confirm {
  align-self: flex-end;
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
  border: 1px solid #fbbf24;
  background: #b45309;
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.pd-confirm:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
