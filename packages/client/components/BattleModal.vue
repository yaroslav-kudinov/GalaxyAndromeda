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
  applyPrioritySkipToggle,
  canTogglePrioritySkipType,
  estimateRoundOneOutcome,
  formatCombatRoundDiceTotals,
  formatShieldContributionLabel,
  SHIP_LABELS,
  SHIP_COMBAT_DICE,
  sumCombatSideDiceTotal,
  COMBAT_PREP_COUNTDOWN_MS,
  SHIP_DESTROY_COST,
  PRIORITY_SKIP_DESTROY_SURCHARGE,
  presentDestructionPriorityChain,
  primaryDestructionType,
  selectableDestructionTypes,
  validateDestructionSelection,
  type ShipUnit,
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
  supportSide: [side: 'attacker' | 'defender' | null]
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
  // При показе бросков — состав из фактических shipRolls раунда (не устаревший preview).
  if (allRolls.value.length) {
    return uniqueTypes(
      allRolls.value
        .filter((r) => r.side === 'attacker' && !r.supportRolls?.length)
        .map((r) => ({ type: r.shipType })),
    )
  }
  return uniqueTypes(props.preview.attacker.ships)
})
const defenderTypesPresent = computed(() => {
  if (allRolls.value.length) {
    return uniqueTypes(
      allRolls.value
        .filter((r) => r.side === 'defender' && !r.supportRolls?.length)
        .map((r) => ({ type: r.shipType })),
    )
  }
  return uniqueTypes(props.preview.defender.ships)
})

function countShipsOfType(side: 'attacker' | 'defender', type: ShipType): number {
  if (side === 'attacker' && isBombardment.value) {
    return props.preview.attacker.supportingShips.filter((s) => s.type === type).length
  }
  if (allRolls.value.length) {
    return allRolls.value.filter(
      (r) => r.side === side && r.shipType === type && !r.supportRolls?.length,
    ).length
  }
  const ships = side === 'attacker' ? props.preview.attacker.ships : props.preview.defender.ships
  return ships.filter((s) => s.type === type).length
}

const attackerSupportShips = computed(() =>
  isBombardment.value ? [] : props.preview.attacker.supportingShips,
)
const defenderSupportShips = computed(() => props.preview.defender.supportingShips)

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

const loserFleetOwnerId = computed(() =>
  props.resolution?.attackerWon ? props.preview.defenderId : props.preview.attackerId,
)

const orderedLoserShips = computed(() => {
  const order = props.resolution?.destructionState?.loserShipIds
  const ships = loserSideShips.value
  if (!order?.length) return ships
  const byId = new Map(ships.map((s) => [s.shipId, s]))
  return order.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s)
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

const destructionSkipTypes = computed((): Set<ShipType> => {
  const fromState = props.resolution?.destructionState?.prioritySkipTypes
  if (fromState) return new Set(fromState)
  const pending = props.snapshot.pendingCombat
  const rs =
    pending && (pending.phase === 'awaiting-destruction' || pending.phase === 'awaiting-continue')
      ? pending.roundState
      : undefined
  if (!rs) return new Set()
  const types = props.resolution?.attackerWon ? rs.attackerSkipTypes : rs.defenderSkipTypes
  return new Set(types)
})

const loserUnitsForValidation = computed((): ShipUnit[] =>
  loserSideShips.value.map((s) => ({
    id: s.shipId,
    type: s.type,
    ownerId: loserFleetOwnerId.value,
  })),
)

function destructionCost(shipId: string): number {
  return props.resolution?.destructionState?.destroyCostByShipId[shipId] ?? 0
}

const selectedDestructionCost = computed(() =>
  selectedDestructionIds.value.reduce((sum, id) => {
    return sum + destructionCost(id)
  }, 0),
)

function destructionSelectionErrors(ids: readonly string[]): string[] {
  if (!ids.length) return []
  const state = props.resolution?.destructionState
  return validateDestructionSelection(
    loserUnitsForValidation.value,
    ids,
    destructionBudget.value,
    destructionSkipTypes.value,
    {
      ignoreDestructionPriority: state?.ignoreDestructionPriority ?? false,
      destroyCostForType: (type) => {
        const sample = loserSideShips.value.find((s) => s.type === type)
        return sample ? destructionCost(sample.shipId) : SHIP_DESTROY_COST[type]
      },
    },
  )
}

function pruneDestructionSelection(ids: readonly string[]): string[] {
  const kept: string[] = []
  for (const id of ids) {
    const trial = [...kept, id]
    if (destructionSelectionErrors(trial).length === 0) kept.push(id)
  }
  return kept
}

function resolutionReadyForRolling(): boolean {
  return props.resolution != null && props.prepPhase == null
}

/**
 * Ключ анимации — только броски текущего раунда. Применение уничтожения меняет
 * fingerprint результата (destroyed/needsSelection), но броски те же — повторно
 * проигрывать анимацию и показывать «старый» состав флота нельзя.
 */
function combatAnimationKey(): string | null {
  if (!props.resolution) return null
  const rolls = roundResult.value?.shipRolls ?? []
  const roundsLen = props.resolution.rounds?.length ?? 1
  return `${roundsLen}:${rolls.map((r) => `${r.shipId}:${r.side}:${r.total}`).join('|')}`
}

function tryStartRollingAnimation() {
  if (!resolutionReadyForRolling()) return
  const key = combatAnimationKey()
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
  () => [combatAnimationKey(), props.prepPhase] as const,
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

/** После confirm-destruction / перехода к continue показываем итог, а не пустой экран выбора */
watch(
  () =>
    [
      props.resolution?.needsDestructionSelection === true,
      props.snapshot.pendingCombat?.phase,
    ] as const,
  ([needsDestruction, pendingPhase]) => {
    if (phase.value !== 'destruction') return
    if (!needsDestruction || pendingPhase === 'awaiting-continue') {
      phase.value = 'post'
    }
  },
)

function playerLabel(id: string): string {
  return props.playerNames?.[id] ?? id
}

function playerColor(id: string): string {
  return props.snapshot.players.find((p) => p.id === id)?.color ?? '#94a3b8'
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
  if (pending?.phase === 'awaiting-continue') {
    const mustContinue = pending.shipsDestroyedInCombat !== true
    if (mustContinue) {
      return pending.continueDecisions?.attacker !== true
        ? 'Уничтожений ещё не было — отступление недоступно. Атакующий подтверждает продолжение.'
        : 'Уничтожений ещё не было — отступление недоступно. Защитник подтверждает продолжение.'
    }
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

function presentTypesOnFleet(fleetSide: 'attacker' | 'defender'): ShipType[] {
  return fleetSide === 'attacker' ? attackerTypesPresent.value : defenderTypesPresent.value
}

function skipTitleOnFleet(fleetSide: 'attacker' | 'defender', type: ShipType): string {
  if (!canToggleSkipOnFleet(fleetSide)) return SHIP_LABELS[type]
  if (isTypeSkippedOnFleet(fleetSide, type)) return 'Снять пропуск (снимет и следующие)'
  if (canInteractSkipOnCard(fleetSide, type)) return 'Пропустить приоритет (+1 цена)'
  const chain = presentDestructionPriorityChain(presentTypesOnFleet(fleetSide))
  if (chain.length <= 1 || chain[chain.length - 1] === type) {
    return 'Пропуск бессмысленен: уже можно атаковать любой корабль этого флота'
  }
  return 'Сначала пропустите предыдущий тип в порядке приоритета'
}

function canInteractSkipOnCard(fleetSide: 'attacker' | 'defender', type: ShipType): boolean {
  if (!canToggleSkipOnFleet(fleetSide)) return false
  return canTogglePrioritySkipType(type, skipsAppliedToFleet(fleetSide), presentTypesOnFleet(fleetSide))
}

function toggleSkipType(side: 'attacker' | 'defender', type: ShipType) {
  const fleetSide: 'attacker' | 'defender' = side === 'attacker' ? 'defender' : 'attacker'
  const refVal = side === 'attacker' ? attackerSkipTypes : defenderSkipTypes
  refVal.value = applyPrioritySkipToggle(type, refVal.value, presentTypesOnFleet(fleetSide))
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
  if (selectedDestructionIds.value.includes(shipId)) {
    selectedDestructionIds.value = pruneDestructionSelection(
      selectedDestructionIds.value.filter((id) => id !== shipId),
    )
    return
  }
  if (!canToggleDestruction(shipId)) return
  selectedDestructionIds.value = [...selectedDestructionIds.value, shipId]
}

function canToggleDestruction(shipId: string): boolean {
  if (selectedDestructionIds.value.includes(shipId)) return true
  return (
    destructionSelectionErrors([...selectedDestructionIds.value, shipId]).length === 0
  )
}

function destructionBlockedReason(shipId: string): string | null {
  if (selectedDestructionIds.value.includes(shipId) || canToggleDestruction(shipId)) return null
  const cost = destructionCost(shipId)
  if (selectedDestructionCost.value + cost > destructionBudget.value) {
    return 'Не хватает бюджета'
  }
  const err = destructionSelectionErrors([...selectedDestructionIds.value, shipId])[0]
  return err ?? 'Сначала корабли выше по приоритету'
}

function confirmDestructionChoice() {
  if (destructionSelectionErrors(selectedDestructionIds.value).length) return
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

/** Skip на флот объявляет противоположная сторона. */
function skipsAppliedToFleet(fleetSide: 'attacker' | 'defender'): ShipType[] {
  return fleetSide === 'attacker' ? defenderSkipTypes.value : attackerSkipTypes.value
}

function isTypeSkippedOnFleet(fleetSide: 'attacker' | 'defender', type: ShipType): boolean {
  return skipsAppliedToFleet(fleetSide).includes(type)
}

function canToggleSkipOnFleet(fleetSide: 'attacker' | 'defender'): boolean {
  if (isThirdParty.value || isDefenderObserver.value) return false
  if (fleetSide === 'defender') {
    if (isBombardment.value && isOnlinePrep.value && !isLocalAttacker.value) return false
    return !isOnlinePrep.value || isLocalAttacker.value
  }
  if (isBombardment.value) return false
  return !isOnlinePrep.value || isLocalDefender.value
}

function toggleSkipOnFleet(fleetSide: 'attacker' | 'defender', type: ShipType) {
  if (!canToggleSkipOnFleet(fleetSide)) return
  const declarer = fleetSide === 'attacker' ? 'defender' : 'attacker'
  toggleSkipType(declarer, type)
}

function destroyCostLabel(type: ShipType, skipped: boolean): string {
  const base = SHIP_DESTROY_COST[type]
  return skipped ? String(base + PRIORITY_SKIP_DESTROY_SURCHARGE) : String(base)
}

function diceForType(type: ShipType): number {
  return SHIP_COMBAT_DICE[type] ?? 0
}

function fleetOwnerId(side: 'attacker' | 'defender'): string {
  return side === 'attacker' ? props.preview.attackerId : props.preview.defenderId
}

function isLocalFleet(side: 'attacker' | 'defender'): boolean {
  return fleetOwnerId(side) === props.localPlayerId
}

const enemyFleetSide = computed((): 'attacker' | 'defender' | null => {
  if (isLocalAttacker.value) return 'defender'
  if (isLocalDefender.value && !isBombardment.value) return 'attacker'
  return null
})

/** Рейка приоритета — флот противника, по которому объявляем skip. */
const priorityRailTypes = computed(() => {
  if (!enemyFleetSide.value) {
    const present = new Set([...attackerTypesPresent.value, ...defenderTypesPresent.value])
    return DESTRUCTION_PRIORITY.filter((t) => present.has(t))
  }
  return presentDestructionPriorityChain(presentTypesOnFleet(enemyFleetSide.value))
})

const mySkipTypes = computed((): ShipType[] => {
  if (isLocalAttacker.value) return attackerSkipTypes.value
  if (isLocalDefender.value) return defenderSkipTypes.value
  return []
})

const mySkipCount = computed(() => mySkipTypes.value.length)

const attackableEnemyTypes = computed((): ShipType[] => {
  if (!enemyFleetSide.value) return []
  return selectableDestructionTypes(presentTypesOnFleet(enemyFleetSide.value), mySkipTypes.value)
})

const primaryEnemyTargetType = computed((): ShipType | null => {
  if (!enemyFleetSide.value) return null
  return primaryDestructionType(presentTypesOnFleet(enemyFleetSide.value), mySkipTypes.value)
})

const attackableEnemyLabels = computed(() =>
  attackableEnemyTypes.value.map((t) => SHIP_LABELS[t]).join(', '),
)

const nextSkippableType = computed((): ShipType | null => {
  if (!enemyFleetSide.value) return null
  const present = presentTypesOnFleet(enemyFleetSide.value)
  const chain = presentDestructionPriorityChain(present)
  for (const t of chain) {
    if (canTogglePrioritySkipType(t, mySkipTypes.value, present) && !mySkipTypes.value.includes(t)) {
      return t
    }
  }
  return null
})

const prepDiceSummary = computed(() => {
  const a =
    props.preview.attacker.combatDiceTotal + props.preview.attacker.supportDiceTotal
  const d =
    props.preview.defender.combatDiceTotal + props.preview.defender.supportDiceTotal
  const edge = (a - d) * 3.5
  return { attackerDice: a, defenderDice: d, expectedEdge: edge }
})

const prepOdds = computed(() =>
  estimateRoundOneOutcome(props.preview, { samples: 160 }),
)

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function railItemClass(t: ShipType): Record<string, boolean> {
  if (!enemyFleetSide.value) return {}
  const skipped = isTypeSkippedOnFleet(enemyFleetSide.value, t)
  const skippable =
    canInteractSkipOnCard(enemyFleetSide.value, t) && !skipped
  const primary = primaryEnemyTargetType.value === t
  const locked =
    canToggleSkipOnFleet(enemyFleetSide.value)
    && !skipped
    && !skippable
    && !primary
  return {
    'priority-rail-item--enemy-skip': skipped,
    'priority-rail-item--skippable': skippable,
    'priority-rail-item--primary': primary && !skipped,
    'priority-rail-item--locked': locked,
  }
}

function isEnemyShipAttackable(fleetSide: 'attacker' | 'defender', type: ShipType): boolean {
  return enemyFleetSide.value === fleetSide && attackableEnemyTypes.value.includes(type)
}

function isEnemyShipPrimary(fleetSide: 'attacker' | 'defender', type: ShipType): boolean {
  return enemyFleetSide.value === fleetSide && primaryEnemyTargetType.value === type
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

          <div class="fleet-arena">
            <section
              class="fleet-col fleet-col--attacker"
              :class="{
                'fleet-col--mine': isLocalFleet('attacker'),
                'fleet-col--target': canToggleSkipOnFleet('attacker'),
              }"
            >
              <header class="fleet-col-head">
                <span class="fleet-swatch" :style="{ background: playerColor(preview.attackerId) }" />
                <div class="fleet-col-titles">
                  <strong>{{ isBombardment ? 'Обстрел' : 'Атака' }}</strong>
                  <span>{{ playerLabel(preview.attackerId) }}</span>
                </div>
                <span
                  v-if="isOnlinePrep"
                  class="ready-pill"
                  :class="{ 'ready-pill--on': attackerReady }"
                  :title="attackerReady ? 'Готов' : 'Не готов'"
                />
              </header>
              <div v-if="attackerTypesPresent.length || attackerSupportShips.length" class="ship-cards">
                <button
                  v-for="t in attackerTypesPresent"
                  :key="'att-' + t"
                  type="button"
                  class="ship-card"
                  :class="{
                    'ship-card--skipped': isTypeSkippedOnFleet('attacker', t),
                    'ship-card--interactive': canInteractSkipOnCard('attacker', t),
                    'ship-card--pulse': canInteractSkipOnCard('attacker', t) && !isTypeSkippedOnFleet('attacker', t),
                    'ship-card--attackable': isEnemyShipAttackable('attacker', t),
                    'ship-card--primary-target': isEnemyShipPrimary('attacker', t),
                    'ship-card--dim':
                      canToggleSkipOnFleet('attacker')
                      && !canInteractSkipOnCard('attacker', t)
                      && !isTypeSkippedOnFleet('attacker', t),
                    'ship-card--mine': isLocalFleet('attacker'),
                  }"
                  :disabled="!canInteractSkipOnCard('attacker', t)"
                  :title="skipTitleOnFleet('attacker', t)"
                  @click="toggleSkipOnFleet('attacker', t)"
                >
                  <svg class="ship-card-glyph" viewBox="-14 -14 28 28" aria-hidden="true">
                    <ShipGlyph :type="t" :player-color="playerColor(preview.attackerId)" :scale="0.9" />
                  </svg>
                  <span v-if="countShipsOfType('attacker', t) > 1" class="ship-card-count">
                    ×{{ countShipsOfType('attacker', t) }}
                  </span>
                  <span v-if="isEnemyShipPrimary('attacker', t)" class="target-badge">цель</span>
                  <span class="ship-card-meta">
                    <span v-if="diceForType(t)" class="meta-dice">{{ diceForType(t) }}d6</span>
                    <span class="meta-cost">{{ destroyCostLabel(t, isTypeSkippedOnFleet('attacker', t)) }}</span>
                  </span>
                  <span v-if="isTypeSkippedOnFleet('attacker', t)" class="skip-badge">+1</span>
                </button>
                <div
                  v-for="sup in attackerSupportShips"
                  :key="'att-sup-' + sup.shipId"
                  class="ship-card ship-card--support"
                  :title="`Поддержка с (${sup.fromCoord.q}, ${sup.fromCoord.r})`"
                >
                  <svg class="ship-card-glyph" viewBox="-14 -14 28 28" aria-hidden="true">
                    <ShipGlyph :type="sup.type" :player-color="playerColor(preview.attackerId)" :scale="0.9" />
                  </svg>
                  <span class="support-tag">поддержка</span>
                  <span class="ship-card-meta">
                    <span class="meta-dice">+{{ sup.supportDice }}d6</span>
                  </span>
                </div>
              </div>
              <p v-else class="fleet-empty">Нет кораблей</p>
            </section>

            <div class="fleet-vs" aria-hidden="true">
              <span>VS</span>
            </div>

            <section
              class="fleet-col fleet-col--defender"
              :class="{
                'fleet-col--mine': isLocalFleet('defender'),
                'fleet-col--target': canToggleSkipOnFleet('defender'),
              }"
            >
              <header class="fleet-col-head">
                <span class="fleet-swatch" :style="{ background: playerColor(preview.defenderId) }" />
                <div class="fleet-col-titles">
                  <strong>Защита</strong>
                  <span>{{ playerLabel(preview.defenderId) }}</span>
                </div>
                <span
                  v-if="isOnlinePrep && !isBombardment"
                  class="ready-pill"
                  :class="{ 'ready-pill--on': defenderReady }"
                  :title="defenderReady ? 'Готов' : 'Не готов'"
                />
              </header>
              <div v-if="defenderTypesPresent.length || defenderSupportShips.length" class="ship-cards">
                <button
                  v-for="t in defenderTypesPresent"
                  :key="'def-' + t"
                  type="button"
                  class="ship-card"
                  :class="{
                    'ship-card--skipped': isTypeSkippedOnFleet('defender', t),
                    'ship-card--interactive': canInteractSkipOnCard('defender', t),
                    'ship-card--pulse': canInteractSkipOnCard('defender', t) && !isTypeSkippedOnFleet('defender', t),
                    'ship-card--attackable': isEnemyShipAttackable('defender', t),
                    'ship-card--primary-target': isEnemyShipPrimary('defender', t),
                    'ship-card--dim':
                      canToggleSkipOnFleet('defender')
                      && !canInteractSkipOnCard('defender', t)
                      && !isTypeSkippedOnFleet('defender', t),
                    'ship-card--mine': isLocalFleet('defender'),
                  }"
                  :disabled="!canInteractSkipOnCard('defender', t)"
                  :title="skipTitleOnFleet('defender', t)"
                  @click="toggleSkipOnFleet('defender', t)"
                >
                  <svg class="ship-card-glyph" viewBox="-14 -14 28 28" aria-hidden="true">
                    <ShipGlyph :type="t" :player-color="playerColor(preview.defenderId)" :scale="0.9" />
                  </svg>
                  <span v-if="countShipsOfType('defender', t) > 1" class="ship-card-count">
                    ×{{ countShipsOfType('defender', t) }}
                  </span>
                  <span v-if="isEnemyShipPrimary('defender', t)" class="target-badge">цель</span>
                  <span class="ship-card-meta">
                    <span v-if="diceForType(t)" class="meta-dice">{{ diceForType(t) }}d6</span>
                    <span class="meta-cost">{{ destroyCostLabel(t, isTypeSkippedOnFleet('defender', t)) }}</span>
                  </span>
                  <span v-if="isTypeSkippedOnFleet('defender', t)" class="skip-badge">+1</span>
                </button>
                <div
                  v-for="sup in defenderSupportShips"
                  :key="'def-sup-' + sup.shipId"
                  class="ship-card ship-card--support"
                  :title="`Поддержка с (${sup.fromCoord.q}, ${sup.fromCoord.r})`"
                >
                  <svg class="ship-card-glyph" viewBox="-14 -14 28 28" aria-hidden="true">
                    <ShipGlyph :type="sup.type" :player-color="playerColor(preview.defenderId)" :scale="0.9" />
                  </svg>
                  <span class="support-tag">поддержка</span>
                  <span class="ship-card-meta">
                    <span class="meta-dice">+{{ sup.supportDice }}d6</span>
                  </span>
                </div>
              </div>
              <p v-else class="fleet-empty">Нет кораблей</p>
            </section>
          </div>

          <div v-if="!isDefenderObserver" class="prep-outlook">
            <p class="prep-odds" title="Оценка по среднему броску 3.5 и симуляции раунда">
              <span class="prep-odds-dice">
                {{ prepDiceSummary.attackerDice }}d6 vs {{ prepDiceSummary.defenderDice }}d6
              </span>
              <span
                class="prep-odds-edge"
                :class="{
                  'prep-odds-edge--att': prepDiceSummary.expectedEdge > 0.5,
                  'prep-odds-edge--def': prepDiceSummary.expectedEdge < -0.5,
                }"
              >
                ожид. перевес
                {{ prepDiceSummary.expectedEdge > 0 ? '+' : '' }}{{ prepDiceSummary.expectedEdge.toFixed(1) }}
              </span>
              <span class="prep-odds-pct">
                атака {{ pct(prepOdds.win) }} · ничья {{ pct(prepOdds.draw) }} · защита {{ pct(prepOdds.defeat) }}
              </span>
            </p>
            <p v-if="enemyFleetSide" class="skip-cue">
              Можно выбрать
              <em>пропуск приоритета</em>
              кликом по
              <template v-if="nextSkippableType">
                мигающему типу
                <strong>{{ SHIP_LABELS[nextSkippableType] }}</strong>
              </template>
              <template v-else>флоту противника</template>
              — только на этот раунд
              <span v-if="mySkipCount" class="skip-cue-count">· пропущено: {{ mySkipCount }}</span>
            </p>
            <p v-if="enemyFleetSide && attackableEnemyLabels" class="attackable-cue">
              При победе можно уничтожать:
              <strong>{{ attackableEnemyLabels }}</strong>
              <span v-if="primaryEnemyTargetType" class="attackable-cue-primary">
                · основная цель: {{ SHIP_LABELS[primaryEnemyTargetType] }}
              </span>
            </p>
          </div>

          <ol
            v-if="priorityRailTypes.length"
            class="priority-rail"
            aria-label="Порядок уничтожения / пропуск приоритета"
          >
            <li
              v-for="(t, i) in priorityRailTypes"
              :key="'rail-' + t"
              class="priority-rail-item"
              :class="railItemClass(t)"
            >
              <span v-if="i > 0" class="priority-rail-arrow" aria-hidden="true">→</span>
              <button
                v-if="enemyFleetSide && canToggleSkipOnFleet(enemyFleetSide)"
                type="button"
                class="priority-rail-btn"
                :disabled="!canInteractSkipOnCard(enemyFleetSide, t)"
                :title="skipTitleOnFleet(enemyFleetSide, t)"
                @click="toggleSkipOnFleet(enemyFleetSide, t)"
              >
                <svg class="priority-rail-glyph" viewBox="-12 -12 24 24" aria-hidden="true">
                  <ShipGlyph
                    :type="t"
                    :player-color="
                      enemyFleetSide === 'defender'
                        ? playerColor(preview.defenderId)
                        : playerColor(preview.attackerId)
                    "
                    :scale="0.7"
                    :show-plate="false"
                  />
                </svg>
                <span class="priority-rail-label">{{ SHIP_LABELS[t] }}</span>
              </button>
              <template v-else>
                <svg class="priority-rail-glyph" viewBox="-12 -12 24 24" aria-hidden="true">
                  <ShipGlyph
                    :type="t"
                    :player-color="
                      enemyFleetSide === 'defender'
                        ? playerColor(preview.defenderId)
                        : enemyFleetSide === 'attacker'
                          ? playerColor(preview.attackerId)
                          : '#94a3b8'
                    "
                    :scale="0.7"
                    :show-plate="false"
                  />
                </svg>
                <span class="priority-rail-label">{{ SHIP_LABELS[t] }}</span>
              </template>
            </li>
          </ol>

          <div v-if="shieldContributions.length" class="shield-chips" title="Щиты защитника">
            <span
              v-for="sh in shieldContributions"
              :key="sh.shipId"
              class="shield-chip"
            >
              <svg class="shield-chip-glyph" viewBox="-12 -12 24 24" aria-hidden="true">
                <ShipGlyph type="shield" player-color="#4ade80" :scale="0.65" :show-plate="false" />
              </svg>
              <span>{{ sh.absorbCapacity }}</span>
            </span>
            <span class="shield-chip-total">макс {{ preview.shieldAbsorbTotal }}</span>
          </div>

          <p v-if="prepPhase === 'countdown' && countdownDisplay != null" class="countdown-banner">
            {{ countdownDisplay || '…' }}
          </p>
          </template>
        </section>

        <template v-else-if="phase === 'destruction'">
          <section class="destruction-phase">
            <h3>Выберите корабли для уничтожения</h3>
            <div class="destruction-budget" aria-live="polite">
              <span class="destruction-budget__label">Бюджет урона</span>
              <span class="destruction-budget__value">
                <strong>{{ selectedDestructionCost }}</strong>
                <span class="destruction-budget__sep">/</span>
                {{ destructionBudget }}
              </span>
              <div class="destruction-budget__bar" aria-hidden="true">
                <div
                  class="destruction-budget__fill"
                  :style="{
                    width: `${destructionBudget > 0 ? Math.min(100, (selectedDestructionCost / destructionBudget) * 100) : 0}%`,
                  }"
                />
              </div>
            </div>
            <p class="hint">
              Порядок: {{ DESTRUCTION_PRIORITY.map((t) => SHIP_LABELS[t]).join(' → ') }}.
              Нельзя взять следующий тип, пока не выбраны (или не пропущены priority skip) все корабли выше.
            </p>
            <p v-if="canSkipDestructionSelection" class="hint">
              Ни один корабль не помещается в бюджет. Раунд завершается без уничтожения.
            </p>
            <ul class="destruction-list" role="list">
              <li v-for="s in orderedLoserShips" :key="s.shipId">
                <button
                  type="button"
                  class="destruction-card"
                  :class="{
                    'destruction-card--immediate': immediatelyDestroyableIds.has(s.shipId),
                    'destruction-card--selected': selectedDestructionIds.includes(s.shipId),
                    'destruction-card--locked': !canToggleDestruction(s.shipId),
                  }"
                  :disabled="!canToggleDestruction(s.shipId)"
                  :aria-pressed="selectedDestructionIds.includes(s.shipId)"
                  :aria-label="`${SHIP_LABELS[s.type]}, стоимость ${destructionCost(s.shipId)}`"
                  @click="toggleDestruction(s.shipId)"
                >
                  <span
                    class="destruction-check"
                    :class="{ 'destruction-check--on': selectedDestructionIds.includes(s.shipId) }"
                    aria-hidden="true"
                  >
                    <svg
                      v-if="selectedDestructionIds.includes(s.shipId)"
                      viewBox="0 0 16 16"
                      class="destruction-check__icon"
                    >
                      <path
                        d="M3.2 8.4 6.5 11.6 12.8 4.4"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </span>
                  <span class="destruction-card__glyph">
                    <ShipGlyph
                      :type="s.type"
                      :player-color="playerColor(loserFleetOwnerId)"
                      :scale="0.85"
                    />
                  </span>
                  <span class="destruction-card__meta">
                    <strong>{{ SHIP_LABELS[s.type] }}</strong>
                    <span class="destruction-card__cost">
                      {{ destructionCost(s.shipId) }}
                      <span class="destruction-card__cost-unit">очков</span>
                    </span>
                  </span>
                  <span
                    v-if="immediatelyDestroyableIds.has(s.shipId) && !selectedDestructionIds.includes(s.shipId)"
                    class="destruction-badge destruction-badge--ready"
                  >
                    доступен
                  </span>
                  <span
                    v-else-if="destructionBlockedReason(s.shipId)"
                    class="destruction-badge destruction-badge--blocked"
                    :title="destructionBlockedReason(s.shipId) ?? undefined"
                  >
                    {{
                      destructionBlockedReason(s.shipId)?.includes('бюджет')
                        ? 'бюджет'
                        : 'приоритет'
                    }}
                  </span>
                </button>
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
          <button type="button" class="btn-secondary" :disabled="resolving" @click="emit('supportSide', null)">
            Не поддерживать
          </button>
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
        <!-- «Начать бой» — только локальная игра: в онлайне бой запускает countdown -->
        <button
          v-else-if="phase === 'pre' && !isOnlinePrep"
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
          :disabled="
            resolving
            || selectedDestructionCost > destructionBudget
            || destructionSelectionErrors(selectedDestructionIds).length > 0
          "
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
  width: min(100%, 720px);
  max-height: min(90vh, 780px);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid rgba(248, 113, 113, 0.5);
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, rgba(127, 29, 29, 0.22), transparent 55%),
    rgba(15, 23, 42, 0.98);
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
.hint {
  margin: 0 0 0.65rem;
  font-size: 0.76rem;
  color: #94a3b8;
  line-height: 1.35;
}
.hint.muted {
  color: #64748b;
}
.fleet-arena {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0.55rem;
  align-items: stretch;
  margin-bottom: 0.55rem;
}
.fleet-col {
  padding: 0.55rem;
  border-radius: 10px;
  border: 1px solid transparent;
  min-width: 0;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.fleet-col--attacker {
  background: rgba(127, 29, 29, 0.28);
  border-color: rgba(248, 113, 113, 0.35);
}
.fleet-col--defender {
  background: rgba(30, 58, 138, 0.28);
  border-color: rgba(96, 165, 250, 0.35);
}
.fleet-col--target {
  box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.35);
}
.fleet-col--mine {
  opacity: 0.95;
}
.fleet-col-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}
.fleet-swatch {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
  flex-shrink: 0;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.6);
}
.fleet-col-titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.fleet-col-titles strong {
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #cbd5e1;
}
.fleet-col-titles span {
  font-size: 0.78rem;
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ready-pill {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  background: #64748b;
  flex-shrink: 0;
}
.ready-pill--on {
  background: #4ade80;
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.55);
}
.fleet-vs {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #64748b;
  padding-top: 1.6rem;
}
.ship-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.ship-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  width: 4.4rem;
  padding: 0.4rem 0.25rem 0.35rem;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(2, 6, 23, 0.45);
  color: inherit;
  cursor: default;
  transition: transform 0.15s, border-color 0.15s, background 0.15s, opacity 0.15s;
}
.ship-card:disabled {
  opacity: 1;
}
.ship-card--interactive {
  cursor: pointer;
}
.ship-card--interactive:hover {
  transform: translateY(-2px);
  border-color: rgba(251, 191, 36, 0.7);
  background: rgba(120, 53, 15, 0.25);
}
.ship-card--interactive:active {
  transform: translateY(0);
}
.ship-card--pulse {
  animation: skip-pulse 1.35s ease-in-out infinite;
}
.ship-card--dim:disabled,
.ship-card--dim {
  opacity: 0.38;
  filter: grayscale(0.45);
}
.ship-card--attackable:not(.ship-card--skipped) {
  border-color: rgba(74, 222, 128, 0.55);
}
.ship-card--primary-target:not(.ship-card--skipped) {
  border-color: rgba(74, 222, 128, 0.85);
  box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.35);
}
.ship-card--skipped {
  border-color: rgba(251, 191, 36, 0.75);
  background: rgba(120, 53, 15, 0.35);
}
.ship-card--skipped .ship-card-glyph {
  opacity: 0.55;
  filter: grayscale(0.35);
}
.target-badge {
  position: absolute;
  top: 0.2rem;
  left: 0.2rem;
  font-size: 0.52rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #052e16;
  background: #4ade80;
  border-radius: 3px;
  padding: 0 0.2rem;
  line-height: 1.25;
}
.ship-card--mine:not(.ship-card--interactive) {
  border-style: dashed;
}
.ship-card--support {
  border-color: rgba(167, 139, 250, 0.55);
  background: rgba(76, 29, 149, 0.25);
}
.support-tag {
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #ddd6fe;
}
.ship-card-glyph {
  width: 2.4rem;
  height: 2.4rem;
  overflow: visible;
}
.ship-card-count {
  position: absolute;
  top: 0.2rem;
  right: 0.25rem;
  font-size: 0.65rem;
  font-weight: 700;
  color: #f8fafc;
  background: rgba(15, 23, 42, 0.85);
  border-radius: 4px;
  padding: 0 0.2rem;
}
.ship-card-meta {
  display: flex;
  gap: 0.25rem;
  font-size: 0.62rem;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}
.meta-dice { color: #fbbf24; }
.meta-cost::before { content: '¤'; margin-right: 0.05rem; opacity: 0.7; }
.skip-badge {
  position: absolute;
  bottom: 0.15rem;
  left: 0.2rem;
  font-size: 0.58rem;
  font-weight: 800;
  color: #0f172a;
  background: #fbbf24;
  border-radius: 3px;
  padding: 0 0.2rem;
  line-height: 1.2;
}
.fleet-empty {
  margin: 0.35rem 0 0;
  font-size: 0.72rem;
  color: #64748b;
}
.prep-outlook {
  margin: 0 0 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.prep-odds {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.35rem 0.65rem;
  padding: 0.35rem 0.5rem;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(71, 85, 105, 0.7);
  font-size: 0.7rem;
  color: #94a3b8;
}
.prep-odds-dice {
  font-weight: 700;
  color: #e2e8f0;
  font-variant-numeric: tabular-nums;
}
.prep-odds-edge {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #cbd5e1;
}
.prep-odds-edge--att { color: #fca5a5; }
.prep-odds-edge--def { color: #93c5fd; }
.prep-odds-pct {
  font-variant-numeric: tabular-nums;
  color: #64748b;
}
.skip-cue {
  margin: 0;
  text-align: center;
  font-size: 0.72rem;
  color: #94a3b8;
  line-height: 1.35;
}
.skip-cue em {
  font-style: normal;
  color: #fde68a;
}
.skip-cue strong {
  color: #fbbf24;
  font-weight: 700;
}
.skip-cue-count {
  color: #fbbf24;
  font-weight: 700;
}
.attackable-cue {
  margin: 0;
  text-align: center;
  font-size: 0.74rem;
  color: #86efac;
  line-height: 1.35;
}
.attackable-cue strong {
  color: #bbf7d0;
  font-weight: 700;
}
.attackable-cue-primary {
  color: #4ade80;
}
.priority-rail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  margin: 0 0 0.55rem;
  padding: 0.35rem 0.45rem;
  list-style: none;
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.4);
  border: 1px solid rgba(51, 65, 85, 0.8);
}
.priority-rail-item {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  opacity: 0.9;
}
.priority-rail-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  margin: 0;
  padding: 0.15rem 0.25rem;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.priority-rail-btn:disabled {
  cursor: default;
}
.priority-rail-item--enemy-skip {
  opacity: 1;
}
.priority-rail-item--enemy-skip .priority-rail-label {
  text-decoration: line-through;
  color: #fde68a;
}
.priority-rail-item--skippable .priority-rail-btn {
  animation: skip-pulse 1.35s ease-in-out infinite;
  border-color: rgba(251, 191, 36, 0.55);
  background: rgba(120, 53, 15, 0.28);
}
.priority-rail-item--primary .priority-rail-label {
  color: #86efac;
  font-weight: 700;
}
.priority-rail-item--locked {
  opacity: 0.32;
  filter: grayscale(0.4);
}
.priority-rail-arrow {
  color: #475569;
  font-size: 0.7rem;
  margin-right: 0.15rem;
}
.priority-rail-glyph {
  width: 1.35rem;
  height: 1.35rem;
  overflow: visible;
}
.priority-rail-label {
  font-size: 0.65rem;
  color: #cbd5e1;
}
@keyframes skip-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.15);
    filter: brightness(1);
  }
  50% {
    box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.28);
    filter: brightness(1.12);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ship-card--pulse,
  .priority-rail-item--skippable .priority-rail-btn {
    animation: none;
  }
}
.shield-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  margin: 0 0 0.5rem;
}
.shield-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.15rem 0.4rem 0.15rem 0.2rem;
  border-radius: 999px;
  background: rgba(20, 83, 45, 0.4);
  border: 1px solid rgba(74, 222, 128, 0.4);
  font-size: 0.72rem;
  font-weight: 700;
  color: #bbf7d0;
  font-variant-numeric: tabular-nums;
}
.shield-chip-glyph {
  width: 1.1rem;
  height: 1.1rem;
  overflow: visible;
}
.shield-chip-total {
  font-size: 0.68rem;
  color: #86efac;
}
.destruction-budget {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.2rem 0.75rem;
  align-items: baseline;
  margin: 0 0 0.65rem;
  padding: 0.55rem 0.7rem;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.65);
  border: 1px solid rgba(71, 85, 105, 0.7);
}
.destruction-budget__label {
  font-size: 0.72rem;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.destruction-budget__value {
  font-size: 1rem;
  color: #e2e8f0;
  font-variant-numeric: tabular-nums;
}
.destruction-budget__value strong {
  color: #fca5a5;
  font-size: 1.15rem;
}
.destruction-budget__sep {
  margin: 0 0.15rem;
  color: #64748b;
}
.destruction-budget__bar {
  grid-column: 1 / -1;
  height: 6px;
  border-radius: 999px;
  background: rgba(51, 65, 85, 0.9);
  overflow: hidden;
}
.destruction-budget__fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #f87171, #fb923c);
  transition: width 0.2s ease;
}
.destruction-list {
  margin: 0.55rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.destruction-card {
  width: 100%;
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem 0.65rem;
  border-radius: 12px;
  border: 1px solid rgba(71, 85, 105, 0.75);
  background: rgba(30, 41, 59, 0.72);
  color: #e2e8f0;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.12s ease,
    opacity 0.15s ease;
}
.destruction-card:hover:not(:disabled) {
  border-color: rgba(148, 163, 184, 0.85);
  background: rgba(51, 65, 85, 0.85);
}
.destruction-card:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
}
.destruction-card--immediate:not(.destruction-card--selected) {
  border-color: rgba(250, 204, 21, 0.55);
  background: rgba(120, 53, 15, 0.22);
  box-shadow: inset 0 0 0 1px rgba(250, 204, 21, 0.12);
}
.destruction-card--selected {
  border-color: rgba(248, 113, 113, 0.75);
  background: linear-gradient(135deg, rgba(127, 29, 29, 0.45), rgba(69, 10, 10, 0.55));
  box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.2);
}
.destruction-card--locked {
  opacity: 0.48;
  cursor: not-allowed;
  filter: grayscale(0.25);
}
.destruction-check {
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 7px;
  border: 2px solid rgba(148, 163, 184, 0.75);
  background: rgba(15, 23, 42, 0.55);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.12s ease;
}
.destruction-check--on {
  border-color: #f87171;
  background: #dc2626;
  color: #fff;
  transform: scale(1.05);
}
.destruction-check__icon {
  width: 0.85rem;
  height: 0.85rem;
}
.destruction-card__glyph {
  width: 1.75rem;
  height: 1.75rem;
  display: grid;
  place-items: center;
}
.destruction-card__meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.destruction-card__meta strong {
  font-size: 0.88rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}
.destruction-card__cost {
  font-size: 0.75rem;
  color: #fca5a5;
  font-variant-numeric: tabular-nums;
}
.destruction-card__cost-unit {
  color: #94a3b8;
  margin-left: 0.15rem;
}
.destruction-badge {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  padding: 0.2rem 0.4rem;
  border-radius: 999px;
  white-space: nowrap;
}
.destruction-badge--ready {
  background: rgba(250, 204, 21, 0.2);
  color: #fde68a;
  border: 1px solid rgba(250, 204, 21, 0.35);
}
.destruction-badge--blocked {
  background: rgba(71, 85, 105, 0.45);
  color: #94a3b8;
  border: 1px solid rgba(100, 116, 139, 0.45);
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
