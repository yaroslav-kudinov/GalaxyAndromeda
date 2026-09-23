<script setup lang="ts">
import type {
  CombatDieRoll,
  CombatOptions,
  CombatParticipant,
  CombatPreview,
  CombatResolutionResult,
  CombatRoundResult,
  ShipCombatRollLog,
  ShipType,
} from '@galaxy/rules'
import {
  COMBAT_PREP_COUNTDOWN_MS,
  estimateBattleOutcome,
  SHIP_LABELS,
} from '@galaxy/rules'
import type { GameSnapshot } from '@galaxy/rules'
import {
  combatDecisionStatusLine,
  combatRoundOutcome,
} from '~/utils/combat-continue-ui'

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
  countdownStartedAt?: number
  /** Fallback: решение continue/retreat прямо в модалке (если баннер скрыт гонкой) */
  continueDecisionRole?: 'attacker' | 'defender' | null
  retreatAllowed?: boolean
  retreatDestinations?: { q: number; r: number }[]
}>()

const emit = defineEmits<{
  close: []
  resolve: [CombatOptions]
  prepReady: [CombatOptions]
  prepUnready: []
  supportSide: [side: 'attacker' | 'defender' | null]
  cancelPrep: []
  countdownComplete: []
  continueCombat: []
  stopCombat: [{ q: number; r: number }]
}>()

const {
  panelRef,
  panelStyle,
  isDragging,
  onDragHandlePointerDown,
  consumeDragClick,
} = useDraggablePanel()

type Phase = 'pre' | 'rolling' | 'post'

const phase = ref<Phase>('pre')
const revealedCount = ref(0)
const animationDone = ref(false)
const countdownDisplay = ref<number | null>(null)
/** Ключ последнего результата, для которого уже запущена/завершена анимация бросков */
const lastAnimatedResolutionKey = ref<string | null>(null)
let countdownTimer: ReturnType<typeof setInterval> | null = null
let countdownCompleteEmitted = false
/**
 * Таймер показа бросков объявлен здесь, а не рядом с функциями ниже: watch с
 * immediate: true может запустить анимацию ещё во время setup — например, у наблюдателя
 * окно боя открывается сразу с готовым итогом. Объявление ниже по файлу попадало бы во
 * временную мёртвую зону и падало с ReferenceError, а вместе с ним падало и всё окно боя.
 */
let revealTimer: ReturnType<typeof setInterval> | null = null

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

const attackerShips = computed(() => (isBombardment.value ? [] : props.preview.attacker.ships))
const defenderShips = computed(() => props.preview.defender.ships)
const attackerSupportShips = computed(() => props.preview.attacker.supportingShips)
const defenderSupportShips = computed(() =>
  isBombardment.value ? [] : props.preview.defender.supportingShips,
)

/** Типы кораблей по id — чтобы подписать цели кубиков, в том числе уже уничтоженные. */
const shipTypeById = computed(() => {
  const map = new Map<string, ShipType>()
  for (const ship of [...props.preview.attacker.ships, ...props.preview.defender.ships]) {
    map.set(ship.shipId, ship.type)
  }
  for (const roll of allRolls.value) map.set(roll.shipId, roll.shipType)
  return map
})

function resolutionReadyForRolling(): boolean {
  return props.resolution != null && props.prepPhase == null
}

/** Ключ анимации — только броски текущего раунда. */
function combatAnimationKey(): string | null {
  if (!props.resolution) return null
  const roundsLen = props.resolution.rounds?.length ?? 1
  const rolls = allRolls.value
    .map((r) => `${r.shipId}:${r.dice.map((d) => `${d.value}>${d.targetShipId ?? '-'}`).join('.')}`)
    .join('|')
  return `${props.resolution.coord.q},${props.resolution.coord.r}:${roundsLen}:${rolls}`
}

function tryStartRollingAnimation() {
  if (!resolutionReadyForRolling()) return
  const key = combatAnimationKey()
  if (!key) return

  if (key === lastAnimatedResolutionKey.value) {
    if (animationDone.value || phase.value === 'post') return
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
      phase.value = 'pre'
      return
    }
    tryStartRollingAnimation()
  },
  { immediate: true },
)

function sideHits(side: 'attacker' | 'defender', revealedOnly: number): number {
  return allRolls.value
    .slice(0, revealedOnly)
    .filter((r) => r.side === side)
    .reduce((sum, r) => sum + r.hits, 0)
}

const attackerRunningHits = computed(() => sideHits('attacker', revealedCount.value))
const defenderRunningHits = computed(() => sideHits('defender', revealedCount.value))
const finalAttackerHits = computed(() => roundResult.value?.attackerHits ?? 0)
const finalDefenderHits = computed(() => roundResult.value?.defenderHits ?? 0)

function startRevealAnimation() {
  revealedCount.value = 0
  animationDone.value = false
  if (revealTimer) clearInterval(revealTimer)

  if (allRolls.value.length === 0) {
    animationDone.value = true
    phase.value = 'post'
    return
  }

  revealTimer = setInterval(() => {
    if (revealedCount.value >= allRolls.value.length) {
      if (revealTimer) clearInterval(revealTimer)
      revealTimer = null
      animationDone.value = true
      phase.value = 'post'
      return
    }
    revealedCount.value++
  }, 650)
}

function playerLabel(id: string): string {
  return props.playerNames?.[id] ?? id
}

function playerColor(id: string): string {
  return props.snapshot.players.find((p) => p.id === id)?.color ?? '#94a3b8'
}

/** CSS-переменная цвета игрока для колонок, бросков и карточек поддержки */
function sideColorVars(playerId: string): { '--side-color': string } {
  return { '--side-color': playerColor(playerId) }
}

function rollLabel(entry: ShipCombatRollLog): string {
  const name = SHIP_LABELS[entry.shipType]
  if (entry.distance > 0) {
    return isBombardment.value ? `${name} · с ${entry.distance} кл.` : `Поддержка · ${name} · ${entry.distance} кл.`
  }
  return name
}

function dieTitle(die: CombatDieRoll): string {
  const target = die.targetShipId ? shipTypeById.value.get(die.targetShipId) : null
  const targetLabel = target ? SHIP_LABELS[target] : 'нет цели'
  return `${die.value} (нужно ${die.threshold}+) → ${targetLabel}: ${die.hit ? 'попадание' : 'промах'}`
}

function dieTargetShort(die: CombatDieRoll): string {
  const target = die.targetShipId ? shipTypeById.value.get(die.targetShipId) : null
  return target ? SHIP_LABELS[target].slice(0, 3) : '—'
}

/** Кубики, порог и прочность корабля одной строкой. */
function shipStatsLabel(ship: Pick<CombatParticipant, 'dice' | 'threshold'>): string {
  if (!ship.dice || ship.threshold == null) return 'не стреляет'
  return `${ship.dice}к · ${ship.threshold}+`
}

function hullPips(ship: Pick<CombatParticipant, 'hull' | 'damage'>): boolean[] {
  return Array.from({ length: ship.hull }, (_, i) => i < ship.hull - ship.damage)
}

const battleOver = computed(() => !props.snapshot.pendingCombat || props.snapshot.pendingCombat.phase === 'prep')

const roundOutcome = computed(() =>
  combatRoundOutcome({
    localPlayerId: props.localPlayerId,
    attackerId: props.preview.attackerId,
    defenderId: props.preview.defenderId,
    winnerId: props.resolution?.winnerId,
    battleOver: battleOver.value,
    stalemate: props.resolution?.stalemate === true,
  }),
)

const decisionStatusText = computed(() =>
  combatDecisionStatusLine({
    pending: props.snapshot.pendingCombat,
    isBombardment: isBombardment.value,
  }),
)

const destroyedShipsText = computed(() => {
  if (!props.resolution?.destroyedShipIds.length) return ''
  const labels = props.resolution.destroyedShipIds.map((id) => {
    const type = shipTypeById.value.get(id)
    return type ? SHIP_LABELS[type] : id
  })
  return `Уничтожено: ${labels.join(', ')}.`
})

const damagedShipsText = computed(() => {
  const damage = props.resolution?.damageByShipId
  if (!damage) return ''
  const parts: string[] = []
  for (const ship of [...props.preview.attacker.ships, ...props.preview.defender.ships]) {
    const taken = damage[ship.shipId]
    if (taken) parts.push(`${SHIP_LABELS[ship.type]} ${taken}/${ship.hull}`)
  }
  return parts.length ? `Повреждены: ${parts.join(', ')}.` : ''
})

const showModalContinueActions = computed(
  () =>
    phase.value === 'post'
    && props.snapshot.pendingCombat?.phase === 'awaiting-continue'
    && props.continueDecisionRole != null,
)

function isLocalFleet(side: 'attacker' | 'defender'): boolean {
  const owner = side === 'attacker' ? props.preview.attackerId : props.preview.defenderId
  return owner === props.localPlayerId
}

const prepOdds = computed(() => estimateBattleOutcome(props.preview, { samples: 200 }))

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function startBattle() {
  emit('resolve', {})
}

function submitPrepReady() {
  emit('prepReady', {})
}

function submitPrepUnready() {
  emit('prepUnready')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && phase.value === 'post') {
    e.preventDefault()
    emit('close')
  }
}

function onBackdropClick() {
  if (consumeDragClick()) return
  if (phase.value === 'post') emit('close')
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
      :class="{
        'battle-modal--dragging': isDragging,
        'battle-modal--results': phase === 'rolling' || phase === 'post',
      }"
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
                : isBombardment
                  ? 'Обстрел'
                  : 'Бой'
            }}
          </h2>
          <p class="battle-sub">
            ({{ preview.coord.q }}, {{ preview.coord.r }}) —
            <span :style="{ color: playerColor(preview.attackerId) }">{{ playerLabel(preview.attackerId) }}</span>
            vs
            <span :style="{ color: playerColor(preview.defenderId) }">{{ playerLabel(preview.defenderId) }}</span>
          </p>
        </div>
        <button v-if="phase === 'post'" type="button" class="close-btn" @click="emit('close')">×</button>
      </header>

      <div class="battle-body">
        <section v-if="phase === 'pre'" class="pre-phase">
          <template v-if="isThirdParty">
            <p class="observer-banner">
              {{ localSupportCandidate ? 'Сейчас будет бой. Ваши корабли рядом могут поддержать одну сторону.' : 'Сейчас будет бой.' }}
            </p>
            <ul v-if="localSupportCandidate" class="support-choice-list">
              <li v-for="ship in localSupportCandidate.ships" :key="ship.shipId">
                <span
                  class="player-swatch"
                  :style="{ background: playerColor(localPlayerId) }"
                  aria-hidden="true"
                />
                {{ SHIP_LABELS[ship.type] }} · {{ ship.dice }}к на {{ ship.threshold }}+
                <span class="muted">({{ ship.fromCoord.q }}, {{ ship.fromCoord.r }})</span>
              </li>
            </ul>
            <p v-if="selfReady" class="observer-hint">
              Готовность подтверждена. Ждём остальных участников.
            </p>
            <p v-else class="observer-hint">
              Выберите сторону или «Не поддерживать» — без вашего ответа бой не начнётся.
            </p>
          </template>
          <template v-else>
          <p v-if="isDefenderObserver" class="observer-banner">
            Вы наблюдаете за обстрелом
          </p>

          <div class="fleet-arena">
            <section
              v-for="side in (['attacker', 'defender'] as const)"
              :key="side"
              class="fleet-col"
              :style="sideColorVars(side === 'attacker' ? preview.attackerId : preview.defenderId)"
              :class="{ 'fleet-col--mine': isLocalFleet(side) }"
            >
              <header class="fleet-col-head">
                <span
                  class="fleet-swatch"
                  :style="{ background: playerColor(side === 'attacker' ? preview.attackerId : preview.defenderId) }"
                />
                <div class="fleet-col-titles">
                  <strong>{{ side === 'attacker' ? (isBombardment ? 'Обстрел' : 'Атака') : 'Защита' }}</strong>
                  <span>{{ playerLabel(side === 'attacker' ? preview.attackerId : preview.defenderId) }}</span>
                </div>
                <span
                  v-if="isOnlinePrep && (side === 'attacker' || !isBombardment)"
                  class="ready-pill"
                  :class="{ 'ready-pill--on': side === 'attacker' ? attackerReady : defenderReady }"
                  :title="(side === 'attacker' ? attackerReady : defenderReady) ? 'Готов' : 'Не готов'"
                />
              </header>
              <div
                v-if="(side === 'attacker' ? attackerShips : defenderShips).length
                  || (side === 'attacker' ? attackerSupportShips : defenderSupportShips).length"
                class="ship-cards"
              >
                <div
                  v-for="ship in (side === 'attacker' ? attackerShips : defenderShips)"
                  :key="ship.shipId"
                  class="ship-card"
                  :class="{ 'ship-card--mine': isLocalFleet(side) }"
                  :title="`${SHIP_LABELS[ship.type]}: ${shipStatsLabel(ship)}, прочность ${ship.hull}`
                    + (ship.bonusDice ? `, от авианосца +${ship.bonusDice}к` : '')"
                >
                  <svg class="ship-card-glyph" viewBox="-14 -14 28 28" aria-hidden="true">
                    <ShipGlyph :type="ship.type" :player-color="playerColor(ship.ownerId)" :scale="0.9" />
                  </svg>
                  <span class="ship-card-meta">
                    <span class="meta-dice">{{ shipStatsLabel(ship) }}</span>
                  </span>
                  <span class="hull-pips" aria-hidden="true">
                    <span
                      v-for="(alive, pi) in hullPips(ship)"
                      :key="pi"
                      class="hull-pip"
                      :class="{ 'hull-pip--lost': !alive }"
                    />
                  </span>
                  <span v-if="ship.bonusDice" class="bonus-badge">+{{ ship.bonusDice }}</span>
                </div>
                <div
                  v-for="sup in (side === 'attacker' ? attackerSupportShips : defenderSupportShips)"
                  :key="'sup-' + sup.shipId"
                  class="ship-card ship-card--support"
                  :style="sideColorVars(sup.ownerId)"
                  :title="`${isBombardment ? 'Обстрел' : 'Поддержка'} · ${playerLabel(sup.ownerId)} · (${sup.fromCoord.q}, ${sup.fromCoord.r}), ${sup.distance} кл.`"
                >
                  <svg class="ship-card-glyph" viewBox="-14 -14 28 28" aria-hidden="true">
                    <ShipGlyph :type="sup.type" :player-color="playerColor(sup.ownerId)" :scale="0.9" />
                  </svg>
                  <span class="support-tag">{{ isBombardment ? 'обстрел' : 'поддержка' }}</span>
                  <span class="ship-card-meta">
                    <span class="meta-dice">{{ sup.dice }}к · {{ sup.threshold }}+</span>
                  </span>
                </div>
              </div>
              <p v-else class="fleet-empty">Нет кораблей</p>
              <p class="fleet-firepower">
                {{ (side === 'attacker' ? preview.attacker : preview.defender).diceTotal }} кубиков ·
                ожидаемо {{ (side === 'attacker' ? preview.attacker : preview.defender).expectedHits.toFixed(1) }} попад.
              </p>
            </section>
          </div>

          <div v-if="!isDefenderObserver" class="prep-outlook">
            <p class="prep-odds" title="Симуляция боя до конца, без отступлений">
              <span class="prep-odds-pct">
                <span :style="{ color: playerColor(preview.attackerId) }">атака {{ pct(prepOdds.win) }}</span>
                · взаимно {{ pct(prepOdds.draw) }}
                ·
                <span :style="{ color: playerColor(preview.defenderId) }">защита {{ pct(prepOdds.defeat) }}</span>
              </span>
            </p>
            <p class="hint muted">
              Кубики распределяются по целям автоматически: сначала добиваются подбитые и самые опасные корабли.
            </p>
          </div>

          <p v-if="prepPhase === 'countdown' && countdownDisplay != null" class="countdown-banner">
            {{ countdownDisplay || '…' }}
          </p>
          </template>
        </section>

        <template v-else>
          <section
            v-if="animationDone && resolution"
            class="outcome-hero"
            :class="{
              'outcome-hero--draw': roundOutcome.kind === 'draw',
              'outcome-hero--win': roundOutcome.kind === 'win',
              'outcome-hero--loss': roundOutcome.kind === 'loss',
              'outcome-hero--side':
                roundOutcome.kind === 'attacker-won' || roundOutcome.kind === 'defender-won',
            }"
            :style="
              roundOutcome.kind === 'attacker-won'
                ? sideColorVars(preview.attackerId)
                : roundOutcome.kind === 'defender-won'
                  ? sideColorVars(preview.defenderId)
                  : undefined
            "
            aria-live="polite"
          >
            <p class="outcome-hero__label">{{ roundOutcome.label }}</p>
            <p class="decision-status">{{ decisionStatusText }}</p>
            <p v-if="destroyedShipsText" class="outcome-hero__note">{{ destroyedShipsText }}</p>
            <p v-if="damagedShipsText" class="outcome-hero__note">{{ damagedShipsText }}</p>
          </section>
          <p v-else class="decision-status decision-status--rolling" role="status">
            Кубики крутятся…
          </p>

          <section class="totals-bar">
            <div class="total-side" :style="sideColorVars(preview.attackerId)">
              <span class="total-label">
                {{ isBombardment ? 'Обстрел' : 'Атакующий' }} · {{ playerLabel(preview.attackerId) }} · попаданий
              </span>
              <span class="total-value">{{ animationDone ? finalAttackerHits : attackerRunningHits }}</span>
            </div>
            <template v-if="!isBombardment">
              <span class="total-vs">vs</span>
              <div class="total-side" :style="sideColorVars(preview.defenderId)">
                <span class="total-label">Защитник · {{ playerLabel(preview.defenderId) }} · попаданий</span>
                <span class="total-value">{{ animationDone ? finalDefenderHits : defenderRunningHits }}</span>
              </div>
            </template>
            <div v-else class="total-side total-side--passive" :style="sideColorVars(preview.defenderId)">
              <span class="total-label">Защитник · {{ playerLabel(preview.defenderId) }}</span>
              <span class="total-value muted">не отвечает</span>
            </div>
          </section>

          <section class="roll-log" aria-live="polite">
            <ul class="roll-list">
              <li
                v-for="(entry, i) in allRolls"
                :key="entry.shipId + '-' + i"
                class="roll-entry"
                :style="sideColorVars(entry.ownerId)"
                :class="{
                  'roll-entry--visible': i < revealedCount || animationDone,
                  'roll-entry--support': entry.distance > 0,
                }"
              >
                <span class="roll-label">{{ rollLabel(entry) }}</span>
                <span class="roll-dice">
                  <span
                    v-for="(d, di) in entry.dice"
                    :key="di"
                    class="die"
                    :class="d.hit ? 'die--hit' : 'die--miss'"
                    :title="dieTitle(d)"
                  >
                    {{ d.value }}
                    <span class="die-target">{{ dieTargetShort(d) }}</span>
                  </span>
                </span>
                <span class="roll-sum">{{ entry.hits }} попад.</span>
              </li>
            </ul>
          </section>
        </template>
      </div>

      <footer class="battle-foot">
        <template v-if="phase === 'pre' && isThirdParty && localSupportCandidate">
          <template v-if="!selfReady">
            <button type="button" class="btn-secondary" :disabled="resolving" @click="emit('supportSide', null)">
              Не поддерживать
            </button>
            <button
              type="button"
              class="btn-side"
              :style="sideColorVars(preview.attackerId)"
              :disabled="resolving"
              @click="emit('supportSide', 'attacker')"
            >
              Поддержать {{ playerLabel(preview.attackerId) }}
            </button>
            <button
              type="button"
              class="btn-side btn-side--emphasis"
              :style="sideColorVars(preview.defenderId)"
              :disabled="resolving"
              @click="emit('supportSide', 'defender')"
            >
              Поддержать {{ playerLabel(preview.defenderId) }}
            </button>
          </template>
          <button
            v-else
            type="button"
            class="btn-secondary"
            :disabled="resolving || prepPhase === 'countdown'"
            @click="emit('prepUnready')"
          >
            {{ resolving ? 'Отмена…' : 'Изменить выбор / снять готовность' }}
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
        <template v-else-if="showModalContinueActions">
          <button
            type="button"
            class="btn-primary"
            :disabled="resolving"
            @click="emit('continueCombat')"
          >
            Продолжить бой
          </button>
          <template v-if="retreatAllowed">
            <button
              v-for="coord in retreatDestinations ?? []"
              :key="`${coord.q},${coord.r}`"
              type="button"
              class="btn-secondary"
              :disabled="resolving"
              @click="emit('stopCombat', coord)"
            >
              Отступить в ({{ coord.q }}, {{ coord.r }})
            </button>
            <span
              v-if="!(retreatDestinations ?? []).length"
              class="post-retreat-empty"
            >
              Нет клетки для отступления
            </span>
          </template>
          <button type="button" class="btn-close" @click="emit('close')">
            Закрыть
          </button>
        </template>
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
  border: 1px solid rgba(100, 116, 139, 0.55);
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, rgba(51, 65, 85, 0.35), transparent 55%),
    rgba(15, 23, 42, 0.98);
  color: #e2e8f0;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
}
.battle-modal--results {
  width: min(100%, 560px);
  max-height: min(86vh, 680px);
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
  color: #e2e8f0;
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
  border: 1px solid color-mix(in srgb, var(--side-color, #94a3b8) 35%, transparent);
  background: color-mix(in srgb, var(--side-color, #94a3b8) 22%, rgba(15, 23, 42, 0.92));
  min-width: 0;
  transition: border-color 0.2s, box-shadow 0.2s;
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
.ship-card--support {
  border-color: color-mix(in srgb, var(--side-color, #a78bfa) 55%, transparent);
  background: color-mix(in srgb, var(--side-color, #a78bfa) 20%, rgba(2, 6, 23, 0.45));
}
.support-tag {
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--side-color, #ddd6fe) 70%, #fff);
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
  color: color-mix(in srgb, var(--side-color, #cbd5e1) 72%, #fff);
}
.prep-odds-pct {
  font-variant-numeric: tabular-nums;
  color: #64748b;
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
  color: color-mix(in srgb, var(--side-color, #94a3b8) 78%, #fff);
}
.total-vs {
  font-size: 0.75rem;
  color: #64748b;
}
.outcome-hero {
  display: grid;
  gap: 0.35rem;
  margin: 0 0 0.75rem;
  padding: 0.7rem 0.8rem 0.75rem;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  background: rgba(51, 65, 85, 0.35);
  text-align: center;
}
.outcome-hero__label {
  margin: 0;
  font-size: clamp(1.7rem, 4.5vw, 2.45rem);
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1.05;
  text-transform: uppercase;
}
.outcome-hero__note {
  margin: 0;
  font-size: 0.78rem;
  color: #cbd5e1;
}
.outcome-hero--draw {
  border-color: rgba(251, 191, 36, 0.7);
  background: rgba(120, 53, 15, 0.32);
  color: #fde68a;
}
.outcome-hero--win {
  border-color: rgba(74, 222, 128, 0.7);
  background: rgba(20, 83, 45, 0.38);
  color: #bbf7d0;
}
.outcome-hero--loss {
  border-color: rgba(248, 113, 113, 0.7);
  background: rgba(127, 29, 29, 0.38);
  color: #fecaca;
}
.outcome-hero--side {
  border-color: color-mix(in srgb, var(--side-color, #94a3b8) 65%, transparent);
  background: color-mix(in srgb, var(--side-color, #94a3b8) 22%, rgba(15, 23, 42, 0.92));
  color: color-mix(in srgb, var(--side-color, #e2e8f0) 55%, #fff);
}
.decision-status {
  margin: 0 0 0.55rem;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
  text-align: center;
  font-size: 0.92rem;
  font-weight: 700;
  color: #f8fafc;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.35);
}
.outcome-hero .decision-status {
  margin: 0;
  background: rgba(2, 6, 23, 0.35);
}
.decision-status--rolling {
  color: #94a3b8;
  font-weight: 600;
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
  background: color-mix(in srgb, var(--side-color, #94a3b8) 20%, rgba(15, 23, 42, 0.88));
  border-left: 3px solid var(--side-color, #94a3b8);
}
.roll-entry--support {
  font-style: italic;
}
.roll-entry--visible {
  opacity: 1;
  transform: translateY(0);
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
  color: #cbd5e1;
  background: rgba(30, 41, 59, 0.55);
  border: 1px solid rgba(100, 116, 139, 0.45);
}
.player-swatch {
  display: inline-block;
  width: 0.55rem;
  height: 0.55rem;
  margin-right: 0.25rem;
  border-radius: 999px;
  vertical-align: middle;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.6);
}
.support-choice-list li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.15rem;
}
.btn-side {
  padding: 0.45rem 0.75rem;
  border-radius: 8px;
  font-size: 0.82rem;
  cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--side-color, #475569) 55%, #fff);
  background: color-mix(in srgb, var(--side-color, #475569) 18%, #1e293b);
  color: color-mix(in srgb, var(--side-color, #e2e8f0) 55%, #fff);
  font-weight: 600;
}
.btn-side--emphasis {
  background: color-mix(in srgb, var(--side-color, #475569) 32%, #1e293b);
}
.btn-side:disabled {
  opacity: 0.6;
  cursor: wait;
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
.post-retreat-empty {
  font-size: 0.8rem;
  color: #fca5a5;
  align-self: center;
}

.fleet-firepower {
  margin: 0.4rem 0 0;
  font-size: 0.7rem;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}
.hull-pips {
  display: inline-flex;
  gap: 0.15rem;
}
.hull-pip {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: #4ade80;
}
.hull-pip--lost {
  background: #7f1d1d;
}
.bonus-badge {
  position: absolute;
  top: 0.2rem;
  right: 0.25rem;
  font-size: 0.58rem;
  font-weight: 800;
  color: #0f172a;
  background: #a78bfa;
  border-radius: 3px;
  padding: 0 0.2rem;
  line-height: 1.2;
}
.die {
  position: relative;
}
.die--hit {
  border-color: #4ade80;
  color: #bbf7d0;
  background: rgba(20, 83, 45, 0.55);
}
.die--miss {
  opacity: 0.55;
}
.die-target {
  position: absolute;
  bottom: -0.85rem;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.5rem;
  font-weight: 600;
  color: #94a3b8;
  white-space: nowrap;
}
.roll-entry {
  padding-bottom: 0.9rem;
}
</style>
