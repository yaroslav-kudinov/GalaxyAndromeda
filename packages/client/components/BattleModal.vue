<script setup lang="ts">
import type {
  BattleLogEntry,
  CombatOptions,
  CombatPreview,
  CombatResolutionResult,
  CombatRoundResult,
  ShipCombatRollLog,
  ShipType,
} from '@galaxy/rules'
import {
  DESTRUCTION_PRIORITY,
  combatResolutionFingerprint,
  formatCombatRoundDiceTotals,
  formatShieldContributionLabel,
  SHIP_LABELS,
  sumCombatSideDiceTotal,
  COMBAT_PREP_COUNTDOWN_MS,
  SHIP_DESTROY_COST,
} from '@galaxy/rules'
import type { ShieldContribution } from '@galaxy/rules'
import type { GameSnapshot } from '@galaxy/rules'

const props = defineProps<{
  preview: CombatPreview
  snapshot: GameSnapshot
  playerNames?: Record<string, string>
  localPlayerId: string
  resolution?: CombatResolutionResult | null
  resolving?: boolean
  /** Мультиплеерная подготовка на сервере */
  prepPhase?: 'prep' | 'countdown' | null
  selfReady?: boolean
  attackerReady?: boolean
  defenderReady?: boolean
  remoteAttackerSkips?: ShipType[]
  remoteDefenderSkips?: ShipType[]
  countdownStartedAt?: number
}>()

const emit = defineEmits<{
  close: []
  resolve: [CombatOptions]
  confirmDestruction: [string[]]
  prepReady: [CombatOptions]
  prepUnready: []
  supportSide: [side: 'attacker' | 'defender']
  cancelPrep: []
  countdownComplete: []
}>()

const {
  panelRef,
  panelStyle,
  isDragging,
  onDragHandlePointerDown,
  consumeDragClick,
} = useDraggablePanel()

type Phase = 'pre' | 'rolling' | 'post' | 'destruction'

const phase = ref<Phase>('pre')
const attackerSkipTypes = ref<ShipType[]>([])
const defenderSkipTypes = ref<ShipType[]>([])
const selectedDestructionIds = ref<string[]>([])
const revealedCount = ref(0)
const animationDone = ref(false)
const countdownDisplay = ref<number | null>(null)
/** Ключ последнего результата, для которого уже запущена/завершена анимация бросков */
const lastAnimatedResolutionKey = ref<string | null>(null)
let countdownTimer: ReturnType<typeof setInterval> | null = null
let countdownCompleteEmitted = false

const isOnlinePrep = computed(() => props.prepPhase != null)
const isBombardment = computed(() => props.preview.trigger === 'bombardment')
const isLocalAttacker = computed(() => props.localPlayerId === props.preview.attackerId)
const isLocalDefender = computed(() => props.localPlayerId === props.preview.defenderId)
const isDefenderObserver = computed(
  () => isBombardment.value && isLocalDefender.value && isOnlinePrep.value,
)
const isThirdParty = computed(
  () => !isLocalAttacker.value && !isLocalDefender.value && isOnlinePrep.value,
)
const localSupportCandidate = computed(() =>
  props.preview.supportCandidates?.find((candidate) => candidate.playerId === props.localPlayerId),
)

watch(
  () => props.remoteAttackerSkips,
  (att) => {
    if (!isLocalAttacker.value && att?.length) attackerSkipTypes.value = [...att]
  },
  { immediate: true },
)

watch(
  () => props.remoteDefenderSkips,
  (def) => {
    if (!isLocalDefender.value && def?.length) defenderSkipTypes.value = [...def]
  },
  { immediate: true },
)

watch(
  () => [props.prepPhase, props.countdownStartedAt] as const,
  ([prepPhase, startedAt]) => {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    countdownCompleteEmitted = false
    if (prepPhase !== 'countdown' || startedAt == null) {
      countdownDisplay.value = null
      return
    }
    const tick = () => {
      const left = Math.ceil((COMBAT_PREP_COUNTDOWN_MS - (Date.now() - startedAt)) / 1000)
      countdownDisplay.value = Math.max(0, left)
      if (left <= 0) {
        if (countdownTimer) {
          clearInterval(countdownTimer)
          countdownTimer = null
        }
        if (!countdownCompleteEmitted) {
          countdownCompleteEmitted = true
          emit('countdownComplete')
        }
      }
    }
    tick()
    countdownTimer = setInterval(tick, 200)
  },
  { immediate: true },
)

const roundResult = computed((): CombatRoundResult | null => {
  if (props.resolution?.rounds?.length) return props.resolution.rounds.at(-1) ?? null
  if (props.resolution?.roundOne) return props.resolution.roundOne
  return null
})

const allRolls = computed((): ShipCombatRollLog[] => roundResult.value?.shipRolls ?? [])

function uniqueTypes(ships: { type: ShipType }[]): ShipType[] {
  return [...new Set(ships.map((s) => s.type))]
}

const attackerTypesPresent = computed(() => {
  if (isBombardment.value) {
    return uniqueTypes(props.preview.attacker.supportingShips.map((s) => ({ type: s.type })))
  }
  return uniqueTypes(props.preview.attacker.ships)
})
const defenderTypesPresent = computed(() => uniqueTypes(props.preview.defender.ships))

const destructionOrderLabels = computed(() =>
  (props.preview.destructionOrder.length ? props.preview.destructionOrder : DESTRUCTION_PRIORITY)
    .map((t) => SHIP_LABELS[t])
    .join(' → '),
)

const needsDestructionSelection = computed(
  () => props.resolution?.needsDestructionSelection === true,
)

const isLocalWinner = computed(() => props.resolution?.winnerId === props.localPlayerId)

const loserSideShips = computed(() => {
  if (!props.resolution) return []
  return props.resolution.attackerWon
    ? props.preview.defender.ships
    : props.preview.attacker.ships
})

const destructionBudget = computed(
  () => props.resolution?.destructionState?.remainingDamage ?? 0,
)

const immediatelyDestroyableIds = computed(
  () => new Set(props.resolution?.destructionState?.immediatelyDestroyableIds ?? []),
)

const selectableIdSet = computed(
  () => new Set(props.resolution?.destructionState?.selectableIds ?? []),
)

const canSkipDestructionSelection = computed(
  () => needsDestructionSelection.value && selectableIdSet.value.size === 0,
)

function destructionCost(shipId: string): number {
  return props.resolution?.destructionState?.destroyCostByShipId[shipId] ?? 0
}

const selectedDestructionCost = computed(() =>
  selectedDestructionIds.value.reduce((sum, id) => {
    return sum + destructionCost(id)
  }, 0),
)

function resolutionReadyForRolling(): boolean {
  return props.resolution != null && props.prepPhase == null
}

function tryStartRollingAnimation() {
  if (!resolutionReadyForRolling()) return
  const key = combatResolutionFingerprint(props.resolution)
  if (!key) return

  if (key === lastAnimatedResolutionKey.value) {
    if (animationDone.value || phase.value === 'post' || phase.value === 'destruction') return
    if (revealTimer) return
  }

  lastAnimatedResolutionKey.value = key
  phase.value = 'rolling'
  startRevealAnimation()
}

watch(
  () => [combatResolutionFingerprint(props.resolution), props.prepPhase] as const,
  ([fp, prepPhase]) => {
    if (!fp) {
      lastAnimatedResolutionKey.value = null
      return
    }
    if (prepPhase != null) {
      if (phase.value !== 'destruction') phase.value = 'pre'
      return
    }
    tryStartRollingAnimation()
  },
  { immediate: true },
)

function sideDiceTotal(side: 'attacker' | 'defender', revealedOnly: number): number {
  return allRolls.value
    .slice(0, revealedOnly)
    .filter((r) => r.side === side)
    .reduce((sum, r) => sum + r.total, 0)
}

const attackerRunningTotal = computed(() => sideDiceTotal('attacker', revealedCount.value))
const defenderRunningTotal = computed(() => sideDiceTotal('defender', revealedCount.value))
const finalAttackerTotal = computed(() =>
  roundResult.value ? sumCombatSideDiceTotal(allRolls.value, 'attacker') : 0,
)
const finalDefenderTotal = computed(() =>
  roundResult.value ? sumCombatSideDiceTotal(allRolls.value, 'defender') : 0,
)
const resolvedRoundNumber = computed(() => props.resolution?.rounds?.length ?? 1)

const roundSummaryText = computed(() =>
  roundResult.value
    ? formatCombatRoundDiceTotals(
        {
          attackerTotal: finalAttackerTotal.value,
          defenderTotal: finalDefenderTotal.value,
          winner: roundResult.value.winner,
        },
        resolvedRoundNumber.value,
        { bombardment: isBombardment.value },
      )
    : '',
)

let revealTimer: ReturnType<typeof setInterval> | null = null

function startRevealAnimation() {
  revealedCount.value = 0
  animationDone.value = false
  if (revealTimer) clearInterval(revealTimer)

  if (allRolls.value.length === 0) {
    animationDone.value = true
    goToPostPhase()
    return
  }

  revealTimer = setInterval(() => {
    if (revealedCount.value >= allRolls.value.length) {
      if (revealTimer) clearInterval(revealTimer)
      revealTimer = null
      animationDone.value = true
      goToPostPhase()
      return
    }
    revealedCount.value++
  }, 650)
}

function goToPostPhase() {
  if (needsDestructionSelection.value && isLocalWinner.value) {
    selectedDestructionIds.value = []
    phase.value = 'destruction'
  } else {
    phase.value = 'post'
  }
}

function playerLabel(id: string): string {
  return props.playerNames?.[id] ?? id
}

function rollLabel(entry: ShipCombatRollLog): string {
  const name = SHIP_LABELS[entry.shipType]
  if (entry.supportRolls?.length) return `Поддержка от ${name}…`
  return `${name} бросает…`
}

function shieldLabel(contribution: ShieldContribution): string {
  return formatShieldContributionLabel(contribution)
}

const shieldContributions = computed(() => props.preview.shieldContributions)

function rollValues(entry: ShipCombatRollLog): number[] {
  if (entry.supportRolls?.length) return entry.supportRolls.flatMap((s) => s.rolls)
  return entry.combatRolls
}

function winnerText(): string {
  if (!props.resolution) return ''
  if (isRoundDraw.value) return 'Ничья раунда'
  const winnerName = playerLabel(props.resolution.winnerId ?? '')
  if (props.resolution.winnerId === props.localPlayerId) {
    return `Вы выиграли раунд (${isBombardment.value ? 'обстрел' : 'бой'})`
  }
  if (
    props.localPlayerId === props.preview.attackerId
    || props.localPlayerId === props.preview.defenderId
  ) {
    return `Вы проиграли раунд — победил ${winnerName}`
  }
  if (props.resolution.attackerWon) {
    return `Победа атакующего (${winnerName})`
  }
  return `Победа защитника (${winnerName})`
}

const isRoundDraw = computed(() =>
  roundResult.value?.winner === 'draw'
  || props.resolution?.rawDamage === 0
  || (props.resolution != null
    && !props.resolution.needsDestructionSelection
    && props.resolution.destroyedShipIds.length === 0),
)

const roundDamageText = computed(() => {
  if (!props.resolution) return ''
  const rawDamage = props.resolution.rawDamage ?? 0
  const absorbed = props.resolution.shieldAbsorbed ?? 0
  const remaining = Math.max(0, rawDamage - absorbed)
  return absorbed > 0
    ? `Разница: ${rawDamage}; щиты поглотили ${absorbed}; на уничтожение ${remaining}.`
    : `Разница: ${rawDamage}; на уничтожение ${remaining}.`
})

const destroyedShipsText = computed(() => {
  if (!props.resolution?.destroyedShipIds.length) return 'Уничтожений нет.'
  const labels = props.resolution.destroyedShipIds.map((id) => {
    const ship = loserSideShips.value.find((candidate) => candidate.shipId === id)
    return ship ? SHIP_LABELS[ship.type] : id
  })
  return `Уничтожено: ${labels.join(', ')}.`
})

const continueStatusText = computed(() => {
  const pending = props.snapshot.pendingCombat
  if (pending?.awaitingContinue) {
    if (pending.continueDecisions?.attacker !== true) {
      return 'Бой продолжается: атакующий выбирает продолжение или отступление.'
    }
    if (pending.continueDecisions?.defender !== true) {
      return 'Бой продолжается: защитник выбирает продолжение или отступление.'
    }
  }
  if (isBombardment.value) return 'Обстрел завершён: клетка не захватывается.'
  return isRoundDraw.value
    ? 'Раунд завершён без уничтожений.'
    : 'Раунд завершён.'
})

function toggleSkipType(side: 'attacker' | 'defender', type: ShipType) {
  const refVal = side === 'attacker' ? attackerSkipTypes : defenderSkipTypes
  const set = new Set(refVal.value)
  if (set.has(type)) {
    set.delete(type)
  } else {
    set.add(type)
  }
  refVal.value = [...set]
}

function buildCombatOptions(): CombatOptions {
  const attSkips = attackerSkipTypes.value.map((shipType) => ({ shipType }))
  const defSkips = defenderSkipTypes.value.map((shipType) => ({ shipType }))
  return {
    attacker: attSkips.length ? { prioritySkips: attSkips } : undefined,
    defender: defSkips.length ? { prioritySkips: defSkips } : undefined,
  }
}

function startBattle() {
  emit('resolve', buildCombatOptions())
}

function submitPrepReady() {
  emit('prepReady', buildCombatOptions())
}

function submitPrepUnready() {
  emit('prepUnready')
}

function toggleDestruction(shipId: string) {
  if (!canToggleDestruction(shipId)) return
  const set = new Set(selectedDestructionIds.value)
  if (set.has(shipId)) set.delete(shipId)
  else set.add(shipId)
  selectedDestructionIds.value = [...set]
}

function canToggleDestruction(shipId: string): boolean {
  if (!selectableIdSet.value.has(shipId)) return false
  if (selectedDestructionIds.value.includes(shipId)) return true
  return selectedDestructionCost.value + destructionCost(shipId) <= destructionBudget.value
}

function confirmDestructionChoice() {
  emit('confirmDestruction', selectedDestructionIds.value)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && (phase.value === 'post' || phase.value === 'destruction')) {
    e.preventDefault()
    if (phase.value !== 'destruction') emit('close')
  }
}

function onBackdropClick() {
  if (consumeDragClick()) return
  if (phase.value === 'post') emit('close')
}

function logEntries(step: BattleLogEntry['step']): BattleLogEntry[] {
  return props.resolution?.log.filter((e) => e.step === step) ?? []
}

function countShipsOfType(side: 'attacker' | 'defender', type: ShipType): number {
  if (side === 'attacker' && isBombardment.value) {
    return props.preview.attacker.supportingShips.filter((s) => s.type === type).length
  }
  const ships = side === 'attacker' ? props.preview.attacker.ships : props.preview.defender.ships
  return ships.filter((s) => s.type === type).length
}

function skipEffectLabel(side: 'attacker' | 'defender', type: ShipType): string {
  const types = side === 'attacker' ? attackerTypesPresent.value : defenderTypesPresent.value
  const index = DESTRUCTION_PRIORITY.indexOf(type)
  const next = DESTRUCTION_PRIORITY.slice(index + 1).find((candidate) => types.includes(candidate))
  const cost = SHIP_DESTROY_COST[type]
  const skipped = (side === 'attacker' ? attackerSkipTypes.value : defenderSkipTypes.value).includes(type)
  const nextText = next ? `открывает уровень N+1: ${SHIP_LABELS[next]}` : 'следующего уровня на этой стороне нет'
  return skipped
    ? `Пропуск активен: destroyCost ${cost} → ${cost + 1}; ${nextText}.`
    : `Пропуск: ${nextText}; цена этого типа станет ${cost} → ${cost + 1}.`
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (revealTimer) clearInterval(revealTimer)
  if (countdownTimer) clearInterval(countdownTimer)
})
</script>

<template>
  <div class="battle-backdrop" @click.self="onBackdropClick">
    <div
      ref="panelRef"
      class="battle-modal"
      :class="{ 'battle-modal--dragging': isDragging }"
      :style="panelStyle"
      role="dialog"
      aria-modal="true"
      aria-labelledby="battle-title"
    >
      <header class="battle-head battle-head--drag" @pointerdown="onDragHandlePointerDown">
        <div>
          <h2 id="battle-title">
            {{
              phase === 'pre'
                ? isBombardment
                  ? 'Подготовка к обстрелу'
                  : 'Подготовка к бою'
                : phase === 'destruction'
                  ? 'Выбор уничтожения'
                  : isBombardment
                    ? 'Обстрел · раунд'
                    : 'Бой · раунд'
            }}
          </h2>
          <p class="battle-sub">
            ({{ preview.coord.q }}, {{ preview.coord.r }}) —
            {{ playerLabel(preview.attackerId) }} vs {{ playerLabel(preview.defenderId) }}
          </p>
        </div>
        <button v-if="phase === 'post'" type="button" class="close-btn" @click="emit('close')">×</button>
      </header>

      <div class="battle-body">
        <section v-if="phase === 'pre'" class="pre-phase">
          <template v-if="isThirdParty">
            <p class="observer-banner">
              {{ localSupportCandidate ? 'Сейчас будет бой. Ваши соседние корабли могут поддержать одну сторону.' : 'Сейчас будет бой.' }}
            </p>
            <ul v-if="localSupportCandidate" class="support-choice-list">
              <li v-for="ship in localSupportCandidate.ships" :key="ship.shipId">
                {{ SHIP_LABELS[ship.type] }} · +{{ ship.supportDice }}d6
                <span class="muted">({{ ship.fromCoord.q }}, {{ ship.fromCoord.r }})</span>
              </li>
            </ul>
          </template>
          <template v-else>
          <p v-if="isDefenderObserver" class="observer-banner">
            Вы наблюдаете за обстрелом
          </p>
          <h3>Приоритет уничтожения</h3>
          <p class="priority-order">{{ destructionOrderLabels }}</p>
          <p class="hint">
            <template v-if="isBombardment">
              При обстреле защитник не бросает кубики: очки уничтожения = сумма броска обстрела.
              Щиты поглощают до {{ preview.shieldAbsorbTotal }} (4+2).
            </template>
            <template v-else>
              При проигрыше раунда корабли уничтожаются в этом порядке (destroyCost). Очки уничтожения =
              разница сумм кубиков (|атакующий − защитник|). Щиты поглощают до {{ preview.shieldAbsorbTotal }} (4+2).
            </template>
          </p>

          <section v-if="shieldContributions.length" class="shield-roster">
            <h3>Щиты защитника</h3>
            <ul class="shield-roster-list">
              <li v-for="sh in shieldContributions" :key="sh.shipId" class="shield-roster-item">
                {{ shieldLabel(sh) }}
                <span class="muted">({{ sh.fromCoord.q }}, {{ sh.fromCoord.r }})</span>
              </li>
            </ul>
          </section>

          <h3>Priority skip по типу корабля</h3>
          <p class="hint">
            Уничтожение идёт по уровням N → N+1. Отметьте тип на уровне N, чтобы временно
            открыть следующую доступную цель N+1. Каждый пропуск добавляет +1 к destroyCost
            всех кораблей пропущенного типа; фишки не тратятся.
          </p>

          <div class="skip-sides">
            <section class="skip-side skip-side--attacker">
              <h4>
                {{ isBombardment ? 'Обстреливающие корабли' : 'Атакующий' }} ·
                {{ playerLabel(preview.attackerId) }}
              </h4>
              <p v-if="isOnlinePrep" class="ready-badge" :class="{ 'ready-badge--on': attackerReady }">
                {{ attackerReady ? 'Готов' : 'Не готов' }}
              </p>
              <ul v-if="attackerTypesPresent.length" class="skip-list">
                <li v-for="t in attackerTypesPresent" :key="'att-' + t">
                  <label :class="{ 'skip-label--readonly': !isLocalAttacker }">
                    <input
                      type="checkbox"
                      :checked="attackerSkipTypes.includes(t)"
                      :disabled="!isLocalAttacker"
                      @change="toggleSkipType('attacker', t)"
                    />
                    {{ SHIP_LABELS[t] }}
                    <span v-if="countShipsOfType('attacker', t) > 1" class="skip-count">
                      ×{{ countShipsOfType('attacker', t) }}
                    </span>
                  </label>
                  <p class="skip-effect" :class="{ 'skip-effect--active': attackerSkipTypes.includes(t) }">
                    {{ skipEffectLabel('attacker', t) }}
                  </p>
                </li>
              </ul>
              <p v-else class="hint muted">
                {{ isBombardment ? 'Нет кораблей обстрела' : 'Нет кораблей на гексе' }}
              </p>
            </section>

            <section class="skip-side skip-side--defender">
              <h4>Защитник · {{ playerLabel(preview.defenderId) }}</h4>
              <p v-if="isBombardment && isOnlinePrep" class="hint muted observer-hint">
                Пассивное наблюдение — skip и готовность не требуются
              </p>
              <template v-else>
                <p v-if="isOnlinePrep" class="ready-badge" :class="{ 'ready-badge--on': defenderReady }">
                  {{ defenderReady ? 'Готов' : 'Не готов' }}
                </p>
                <ul v-if="defenderTypesPresent.length" class="skip-list">
                  <li v-for="t in defenderTypesPresent" :key="'def-' + t">
                    <label :class="{ 'skip-label--readonly': !isLocalDefender }">
                      <input
                        type="checkbox"
                        :checked="defenderSkipTypes.includes(t)"
                        :disabled="!isLocalDefender"
                        @change="toggleSkipType('defender', t)"
                      />
                      {{ SHIP_LABELS[t] }}
                      <span v-if="countShipsOfType('defender', t) > 1" class="skip-count">
                        ×{{ countShipsOfType('defender', t) }}
                      </span>
                    </label>
                  <p class="skip-effect" :class="{ 'skip-effect--active': defenderSkipTypes.includes(t) }">
                    {{ skipEffectLabel('defender', t) }}
                  </p>
                  </li>
                </ul>
                <p v-else class="hint muted">Нет кораблей на гексе</p>
              </template>
            </section>
          </div>

          <p v-if="prepPhase === 'countdown' && countdownDisplay != null" class="countdown-banner">
            {{ isBombardment ? 'Обстрел' : 'Бой' }} через {{ countdownDisplay || '…' }}
          </p>
          </template>
        </section>

        <template v-else-if="phase === 'destruction'">
          <section class="destruction-phase">
            <h3>Выберите корабли для уничтожения</h3>
            <p class="hint">
              Бюджет урона: <strong>{{ destructionBudget }}</strong>.
              Выбрано: {{ selectedDestructionCost }} / {{ destructionBudget }}.
              Подсветка — корабли первого доступного tier.
            </p>
            <p v-if="canSkipDestructionSelection" class="hint">
              Ни один корабль не помещается в бюджет. Раунд завершается без уничтожения.
            </p>
            <ul class="destruction-list">
              <li
                v-for="s in loserSideShips"
                :key="s.shipId"
                class="destruction-item"
                :class="{
                  'destruction-item--immediate': immediatelyDestroyableIds.has(s.shipId),
                  'destruction-item--disabled': !canToggleDestruction(s.shipId),
                  'destruction-item--selected': selectedDestructionIds.includes(s.shipId),
                }"
              >
                <label>
                  <input
                    type="checkbox"
                    :checked="selectedDestructionIds.includes(s.shipId)"
                    :disabled="!canToggleDestruction(s.shipId)"
                    @change="toggleDestruction(s.shipId)"
                  />
                  {{ SHIP_LABELS[s.type] }} — destroyCost {{ destructionCost(s.shipId) }}
                  <span v-if="immediatelyDestroyableIds.has(s.shipId)" class="immediate-tag">сразу</span>
                </label>
              </li>
            </ul>
          </section>
        </template>

        <template v-else>
          <section class="totals-bar">
            <div class="total-side total-side--attacker">
              <span class="total-label">{{ isBombardment ? 'Обстрел · сумма кубиков' : 'Атакующий · сумма кубиков' }}</span>
              <span class="total-value">{{ animationDone ? finalAttackerTotal : attackerRunningTotal }}</span>
            </div>
            <template v-if="!isBombardment">
              <span class="total-vs">vs</span>
              <div class="total-side total-side--defender">
                <span class="total-label">Защитник · сумма кубиков</span>
                <span class="total-value">{{ animationDone ? finalDefenderTotal : defenderRunningTotal }}</span>
              </div>
            </template>
            <div v-else class="total-side total-side--defender total-side--passive">
              <span class="total-label">Защитник</span>
              <span class="total-value muted">не бросает</span>
            </div>
          </section>

          <section class="roll-log" aria-live="polite">
            <h3>Броски кубиков</h3>
            <ul class="roll-list">
              <li
                v-for="(entry, i) in allRolls"
                :key="entry.shipId + '-' + i"
                class="roll-entry"
                :class="{
                  'roll-entry--visible': i < revealedCount,
                  'roll-entry--attacker': entry.side === 'attacker',
                  'roll-entry--defender': entry.side === 'defender',
                  'roll-entry--support': !!entry.supportRolls?.length,
                }"
              >
                <span class="roll-label">{{ rollLabel(entry) }}</span>
                <span class="roll-dice">
                  <span v-for="(d, di) in rollValues(entry)" :key="di" class="die">{{ d }}</span>
                </span>
                <span class="roll-sum">= {{ entry.total }}</span>
              </li>
              <li
                v-for="sh in shieldContributions"
                :key="'shield-' + sh.shipId"
                class="roll-entry roll-entry--shield roll-entry--visible"
              >
                <span class="roll-label">{{ shieldLabel(sh) }}</span>
                <span class="roll-shield-badge">без кубиков</span>
                <span class="roll-sum">до {{ sh.absorbCapacity }}</span>
              </li>
            </ul>
            <p v-if="animationDone" class="round-summary">{{ roundSummaryText }}</p>
            <p v-if="animationDone && resolution" class="round-winner">{{ winnerText() }}</p>
            <p v-else-if="!animationDone" class="rolling-hint">Кубики крутятся…</p>
          </section>

          <section v-if="phase === 'post' && resolution" class="post-phase">
            <h3>Итог раунда</h3>
            <div
              class="round-outcome"
              :class="{
                'round-outcome--draw': isRoundDraw,
                'round-outcome--win': !isRoundDraw && resolution.winnerId === localPlayerId,
                'round-outcome--loss':
                  !isRoundDraw
                  && (localPlayerId === preview.attackerId || localPlayerId === preview.defenderId)
                  && resolution.winnerId !== localPlayerId,
              }"
            >
              <strong>{{ winnerText() }}</strong>
              <span>{{ roundSummaryText }}</span>
              <span>{{ roundDamageText }}</span>
              <span>{{ destroyedShipsText }}</span>
              <span>{{ continueStatusText }}</span>
            </div>
            <ul class="post-log">
              <li v-for="(entry, i) in logEntries('shield-absorb')" :key="'sh-' + i">{{ entry.message }}</li>
              <li v-for="(entry, i) in logEntries('destruction')" :key="'ds-' + i">{{ entry.message }}</li>
            </ul>
          </section>
        </template>
      </div>

      <footer class="battle-foot">
        <template v-if="phase === 'pre' && isThirdParty && localSupportCandidate">
          <button type="button" class="btn-secondary" :disabled="resolving" @click="emit('supportSide', 'attacker')">
            Поддержать атакующего
          </button>
          <button type="button" class="btn-primary" :disabled="resolving" @click="emit('supportSide', 'defender')">
            Поддержать защитника
          </button>
        </template>
        <template v-if="phase === 'pre' && isOnlinePrep && !isDefenderObserver && !isThirdParty">
          <button
            v-if="localPlayerId === preview.attackerId"
            type="button"
            class="btn-secondary"
            :disabled="resolving"
            @click="emit('cancelPrep')"
          >
            {{ isBombardment ? 'Отменить обстрел' : 'Отменить бой' }}
          </button>
          <button
            v-if="!selfReady"
            type="button"
            class="btn-primary"
            :disabled="resolving || prepPhase === 'countdown'"
            @click="submitPrepReady"
          >
            {{ resolving ? 'Отправка…' : 'Готов' }}
          </button>
          <button
            v-else
            type="button"
            class="btn-secondary"
            :disabled="resolving"
            @click="submitPrepUnready"
          >
            {{ resolving ? 'Отмена…' : 'Отменить готовность' }}
          </button>
        </template>
        <button
          v-else-if="phase === 'pre'"
          type="button"
          class="btn-primary"
          :disabled="resolving"
          @click="startBattle"
        >
          {{ resolving ? 'Разрешение…' : 'Начать бой' }}
        </button>
        <button
          v-else-if="phase === 'destruction'"
          type="button"
          class="btn-primary"
          :disabled="resolving || selectedDestructionCost > destructionBudget"
          @click="confirmDestructionChoice"
        >
          {{
            resolving
              ? 'Применение…'
              : canSkipDestructionSelection
                ? 'Ничья / Продолжить без уничтожения'
                : 'Подтвердить уничтожение'
          }}
        </button>
        <button v-else-if="phase === 'post'" type="button" class="btn-close" @click="emit('close')">
          Закрыть (Esc)
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.battle-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(2, 6, 23, 0.72);
  pointer-events: auto;
}
.battle-modal {
  width: min(100%, 560px);
  max-height: min(90vh, 720px);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid rgba(248, 113, 113, 0.5);
  background: rgba(15, 23, 42, 0.98);
  color: #e2e8f0;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
}
.battle-head {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid #334155;
}
.battle-head--drag {
  cursor: grab;
  user-select: none;
}
.battle-modal--dragging .battle-head--drag {
  cursor: grabbing;
}
.battle-head h2 {
  margin: 0;
  font-size: 1rem;
  color: #fecaca;
}
.battle-sub {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: #94a3b8;
}
.close-btn {
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 1.4rem;
  cursor: pointer;
}
.battle-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 1rem;
}
.pre-phase h3,
.roll-log h3,
.post-phase h3,
.destruction-phase h3 {
  margin: 0 0 0.4rem;
  font-size: 0.82rem;
  color: #94a3b8;
}
.priority-order {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  line-height: 1.35;
}
.hint {
  margin: 0 0 0.65rem;
  font-size: 0.76rem;
  color: #94a3b8;
  line-height: 1.35;
}
.hint.muted {
  color: #64748b;
}
.skip-sides {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}
.skip-side {
  padding: 0.45rem;
  border-radius: 8px;
  font-size: 0.78rem;
}
.skip-side h4 {
  margin: 0 0 0.35rem;
  font-size: 0.72rem;
}
.skip-side--attacker {
  background: rgba(127, 29, 29, 0.35);
  border: 1px solid rgba(248, 113, 113, 0.35);
}
.skip-side--defender {
  background: rgba(30, 58, 138, 0.35);
  border: 1px solid rgba(96, 165, 250, 0.35);
}
.skip-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.skip-list li {
  margin-bottom: 0.35rem;
}
.skip-list label {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}
.skip-label--readonly {
  opacity: 0.75;
  cursor: default;
}
.skip-count {
  font-size: 0.7rem;
  color: #94a3b8;
}
.skip-effect {
  margin: 0.2rem 0 0 1.4rem;
  font-size: 0.68rem;
  line-height: 1.3;
  color: #94a3b8;
}
.skip-effect--active {
  color: #fde68a;
}
.destruction-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.destruction-item {
  margin-bottom: 0.35rem;
  padding: 0.35rem 0.45rem;
  border-radius: 6px;
  border: 1px solid transparent;
  font-size: 0.8rem;
}
.destruction-item label {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.destruction-item--immediate {
  border-color: rgba(234, 179, 8, 0.55);
  background: rgba(234, 179, 8, 0.12);
}
.destruction-item--selected {
  border-color: rgba(248, 113, 113, 0.6);
  background: rgba(127, 29, 29, 0.25);
}
.destruction-item--disabled {
  opacity: 0.45;
}
.destruction-item--disabled label {
  cursor: not-allowed;
}
.immediate-tag {
  font-size: 0.65rem;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  background: rgba(234, 179, 8, 0.25);
  color: #fde68a;
}
.totals-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  padding: 0.5rem;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
}
.total-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 5rem;
}
.total-label {
  font-size: 0.68rem;
  color: #94a3b8;
}
.total-value {
  font-size: 1.4rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.total-side--attacker .total-value { color: #fca5a5; }
.total-side--defender .total-value { color: #93c5fd; }
.total-vs {
  font-size: 0.75rem;
  color: #64748b;
}
.roll-list {
  margin: 0 0 0.65rem;
  padding: 0;
  list-style: none;
}
.roll-entry {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.35rem 0.45rem;
  margin-bottom: 0.25rem;
  border-radius: 6px;
  font-size: 0.8rem;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.25s, transform 0.25s;
}
.roll-entry--visible {
  opacity: 1;
  transform: translateY(0);
}
.roll-entry--attacker {
  background: rgba(127, 29, 29, 0.35);
  border-left: 3px solid #f87171;
}
.roll-entry--defender {
  background: rgba(30, 58, 138, 0.35);
  border-left: 3px solid #60a5fa;
}
.roll-entry--support {
  font-style: italic;
}
.roll-entry--shield {
  background: rgba(20, 83, 45, 0.45);
  border-left: 3px solid #4ade80;
}
.roll-shield-badge {
  font-size: 0.72rem;
  color: #86efac;
  font-style: italic;
}
.shield-roster {
  margin-bottom: 0.65rem;
}
.shield-roster h3 {
  margin: 0 0 0.35rem;
  font-size: 0.82rem;
  color: #86efac;
}
.shield-roster-list {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.78rem;
}
.shield-roster-item {
  margin-bottom: 0.25rem;
  padding: 0.3rem 0.45rem;
  border-radius: 6px;
  background: rgba(20, 83, 45, 0.35);
  border-left: 3px solid #4ade80;
}
.roll-label {
  min-width: 9rem;
  color: #e2e8f0;
}
.roll-dice {
  display: inline-flex;
  gap: 0.25rem;
}
.die {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 4px;
  background: #1e293b;
  border: 1px solid #475569;
  font-weight: 700;
  font-size: 0.85rem;
  color: #fbbf24;
  font-variant-numeric: tabular-nums;
}
.roll-sum {
  margin-left: auto;
  font-weight: 600;
  color: #cbd5e1;
}
.round-summary {
  margin: 0.35rem 0 0;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  background: rgba(51, 65, 85, 0.45);
  border: 1px solid rgba(148, 163, 184, 0.35);
  font-size: 0.82rem;
  color: #e2e8f0;
  font-weight: 600;
}
.round-winner {
  margin: 0.35rem 0 0.65rem;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  background: rgba(234, 179, 8, 0.15);
  border: 1px solid rgba(234, 179, 8, 0.4);
  font-size: 0.82rem;
  color: #fde68a;
  font-weight: 600;
}
.rolling-hint {
  margin: 0.35rem 0 0.65rem;
  font-size: 0.78rem;
  color: #94a3b8;
}
.post-log {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.8rem;
  line-height: 1.45;
}
.round-outcome {
  display: grid;
  gap: 0.28rem;
  margin: 0 0 0.65rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 8px;
  background: rgba(51, 65, 85, 0.35);
  font-size: 0.8rem;
  line-height: 1.35;
}
.round-outcome strong {
  font-size: 0.88rem;
}
.round-outcome--draw {
  border-color: rgba(251, 191, 36, 0.55);
  background: rgba(120, 53, 15, 0.22);
  color: #fde68a;
}
.round-outcome--win {
  border-color: rgba(74, 222, 128, 0.5);
  background: rgba(20, 83, 45, 0.25);
  color: #bbf7d0;
}
.round-outcome--loss {
  border-color: rgba(248, 113, 113, 0.5);
  background: rgba(127, 29, 29, 0.25);
  color: #fecaca;
}
.post-win { color: #86efac; }
.post-loss { color: #fca5a5; }
.battle-foot {
  padding: 0.65rem 1rem;
  border-top: 1px solid #334155;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.btn-primary,
.btn-close {
  padding: 0.45rem 0.75rem;
  border-radius: 8px;
  font-size: 0.82rem;
  cursor: pointer;
}
.btn-primary {
  border: 1px solid #dc2626;
  background: #991b1b;
  color: #fff;
  font-weight: 600;
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: wait;
}
.btn-secondary {
  padding: 0.45rem 0.75rem;
  border-radius: 8px;
  font-size: 0.82rem;
  cursor: pointer;
  border: 1px solid #475569;
  background: #1e293b;
  color: #e2e8f0;
}
.btn-secondary:disabled {
  opacity: 0.6;
  cursor: wait;
}
.ready-badge {
  margin: 0 0 0.35rem;
  font-size: 0.72rem;
  color: #94a3b8;
}
.ready-badge--on {
  color: #86efac;
  font-weight: 600;
}
.countdown-banner {
  margin: 0.75rem 0 0;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  text-align: center;
  font-size: 1.25rem;
  font-weight: 700;
  color: #fde68a;
  background: rgba(234, 179, 8, 0.15);
  border: 1px solid rgba(234, 179, 8, 0.45);
}
.observer-banner {
  margin: 0 0 0.65rem;
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  font-size: 0.78rem;
  line-height: 1.35;
  color: #bfdbfe;
  background: rgba(30, 58, 138, 0.35);
  border: 1px solid rgba(96, 165, 250, 0.45);
}
.observer-hint {
  margin: 0;
}
.support-choice-list {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.78rem;
}
.btn-close {
  border: 1px solid #475569;
  background: #334155;
  color: #f8fafc;
}
</style>
