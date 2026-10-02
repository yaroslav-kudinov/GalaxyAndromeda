<script setup lang="ts">
import type { BattleForecast, CombatParticipant, CombatPreview } from '@galaxy/rules'
import { SHIP_LABELS, combatDiceReport } from '@galaxy/rules'
import {
  diceBreakdownLines,
  formatNumber,
  formatPercent,
  outcomeHeading,
  outcomeNote,
  outcomeRows,
  roundDamageLine,
  roundDamageStats,
} from '~/utils/combat-forecast-ui'

const props = defineProps<{
  preview: CombatPreview
  playerNames?: Record<string, string>
  forecast?: BattleForecast | null
  /** Выбранные корабли, которым клетка назначения ещё не указана. */
  unassignedShips?: number
  /** Показать кнопку «Разрешение боя» (после подтверждения действия) */
  showBattleAction?: boolean
}>()

const panelTitle = computed(() =>
  props.preview.trigger === 'bombardment' ? 'Превью обстрела' : 'Превью боя',
)

const leadText = computed(() => {
  if (props.preview.trigger === 'bombardment') {
    return 'Обстрел по цели добавлен в действие. Защитник не отвечает; каждая клетка расстояния прибавляет 1 к нужному значению.'
  }
  return 'Ход на эту клетку добавлен в действие. Бой идёт раундами, урон копится до конца боя.'
})

const isBombardment = computed(() => props.preview.trigger === 'bombardment')

const emit = defineEmits<{
  showBattle: []
  dismiss: []
}>()

const COLLAPSED_STORAGE_KEY = 'galaxy:combat-preview-collapsed'

const collapsed = ref(false)

const {
  panelRef,
  panelStyle,
  isDragging,
  onDragHandlePointerDown,
} = useDraggablePanel()

onMounted(() => {
  if (import.meta.client) {
    try {
      collapsed.value = sessionStorage.getItem(COLLAPSED_STORAGE_KEY) === '1'
    } catch {
      collapsed.value = false
    }
  }
})

function toggleCollapsed() {
  collapsed.value = !collapsed.value
  if (import.meta.client) {
    try {
      sessionStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed.value ? '1' : '0')
    } catch {
      // Хранилище недоступно — свёрнутость просто не запомнится.
    }
  }
}

function playerLabel(id: string): string {
  return props.playerNames?.[id] ?? id
}

const pct = formatPercent

/** Корабль как цель: кубики и порог названы в расшифровке ниже, здесь — прочность и урон. */
function shipLine(ship: CombatParticipant): string {
  const taken = ship.damage > 0 ? `, попаданий ${ship.damage} из ${ship.hull}` : ''
  return `${SHIP_LABELS[ship.type]} · прочность ${ship.hull}${taken}`
}

/** Панель показывают только атакующему: приказ составляет он. */
const roundStats = computed(() =>
  props.forecast ? roundDamageStats(props.forecast.round, 'attacker') : null,
)
const outcome = computed(() =>
  props.forecast && !isBombardment.value ? outcomeRows(props.forecast.outcome, 'attacker') : null,
)
const outcomeTitle = computed(() => outcomeHeading(props.forecast?.exact !== false))
const outcomeHint = computed(() => outcomeNote(props.forecast?.exact !== false))

/** Открыт ли блок «если драться до конца». Игрок решает на раунд, поэтому по умолчанию закрыт. */
const outcomeOpen = ref(false)

const attackerDice = computed(() => diceBreakdownLines(combatDiceReport(props.preview, 'attacker')))
const defenderDice = computed(() => diceBreakdownLines(combatDiceReport(props.preview, 'defender')))

const compactLine = computed(() => {
  const forecast = props.forecast
  if (!forecast) return null
  if (isBombardment.value) {
    return `попаданий ожидаемо ${formatNumber(forecast.round.attackerHits)}`
  }
  return roundDamageLine(forecast.round, 'attacker')
})

const incompleteOrderNote = computed(() => {
  const left = props.unassignedShips ?? 0
  if (left <= 0) return null
  return left === 1
    ? 'Одному выбранному кораблю клетка ещё не указана — он в прогнозе не учтён.'
    : `Ещё ${left} выбранным кораблям клетка не указана — они в прогнозе не учтены.`
})
</script>

<template>
  <aside
    ref="panelRef"
    class="combat-preview"
    :class="{
      'combat-preview--collapsed': collapsed,
      'combat-preview--dragging': isDragging,
    }"
    :style="panelStyle"
    role="complementary"
    aria-label="Превью боя"
  >
    <header
      class="combat-preview__head combat-preview__head--drag"
      @pointerdown="onDragHandlePointerDown"
    >
      <h3 class="combat-preview__title">{{ panelTitle }}</h3>
      <span class="combat-preview__coord">({{ preview.coord.q }}, {{ preview.coord.r }})</span>
      <button
        type="button"
        class="combat-preview__collapse"
        :aria-expanded="!collapsed"
        :title="collapsed ? 'Развернуть' : 'Свернуть'"
        @click="toggleCollapsed"
      >
        {{ collapsed ? '▸' : '▾' }}
      </button>
      <button
        v-if="showBattleAction"
        type="button"
        class="combat-preview__close"
        title="Закрыть"
        @click="emit('dismiss')"
      >
        ×
      </button>
    </header>

    <p v-if="collapsed && compactLine" class="combat-preview__compact">
      За раунд: {{ compactLine }}
    </p>
    <p v-else-if="collapsed" class="combat-preview__compact combat-preview__compact--muted">
      Прогноз боя недоступен
    </p>

    <template v-if="!collapsed">
      <p class="combat-preview__lead">
        {{ leadText }}
      </p>

      <section v-if="roundStats" class="round-damage">
        <h4>{{ isBombardment ? 'Один обстрел' : 'Один раунд боя' }}</h4>
        <div class="round-damage__stats">
          <p
            v-for="stat in roundStats"
            :key="stat.tone"
            class="round-damage__stat"
            :class="`round-damage__stat--${stat.tone}`"
          >
            <span class="round-damage__label">{{ stat.label }}</span>
            <span class="round-damage__value">{{ stat.value }}</span>
          </p>
        </div>
        <p v-if="incompleteOrderNote" class="round-damage__warn">{{ incompleteOrderNote }}</p>
      </section>

      <section v-if="outcome" class="round-odds">
        <button type="button" class="round-odds__toggle" :aria-expanded="outcomeOpen" @click="outcomeOpen = !outcomeOpen">
          <span>{{ outcomeOpen ? '▾' : '▸' }}</span>
          <span>{{ outcomeTitle }}</span>
        </button>
        <template v-if="outcomeOpen">
          <div class="odds-bars">
            <div v-for="row in outcome" :key="row.tone" class="odds-row" :title="row.hint">
              <span class="odds-label" :class="`odds-label--${row.tone}`">{{ row.label }}</span>
              <div class="odds-track">
                <div class="odds-fill" :class="`odds-fill--${row.tone}`" :style="{ width: pct(row.value) }" />
              </div>
              <span class="odds-pct">{{ pct(row.value) }}</span>
            </div>
          </div>
          <p class="odds-note">{{ outcomeHint }}</p>
        </template>
      </section>

      <div class="combat-preview__sides">
        <section class="side side--attacker">
          <h4>Атакующий · {{ playerLabel(preview.attackerId) }}</h4>
          <ul class="ship-chips">
            <li v-for="s in preview.attacker.ships" :key="s.shipId">
              {{ shipLine(s) }}
            </li>
            <li v-if="!preview.attacker.ships.length" class="muted">
              {{ preview.trigger === 'bombardment' ? 'корабли обстрела' : 'корабли из хода' }}
            </li>
          </ul>
          <ul class="dice-breakdown">
            <li v-for="line in attackerDice" :key="line">{{ line }}</li>
          </ul>
          <p v-if="forecast" class="dice-line">
            Ожидаемо попаданий: {{ formatNumber(forecast.round.attackerHits) }}
          </p>
        </section>

        <section class="side side--defender">
          <h4>Защитник · {{ playerLabel(preview.defenderId) }}</h4>
          <ul class="ship-chips">
            <li v-for="s in preview.defender.ships" :key="s.shipId">
              {{ shipLine(s) }}
            </li>
          </ul>
          <p v-if="preview.trigger === 'bombardment'" class="dice-line muted">
            Не отвечает на обстрел
          </p>
          <template v-else>
            <ul class="dice-breakdown">
              <li v-for="line in defenderDice" :key="line">{{ line }}</li>
            </ul>
            <p v-if="forecast" class="dice-line">
              Ожидаемо попаданий: {{ formatNumber(forecast.round.defenderHits) }}
            </p>
          </template>
        </section>
      </div>

      <footer v-if="showBattleAction" class="combat-preview__actions">
        <button type="button" class="btn-battle" @click="emit('showBattle')">
          Подготовка к бою
        </button>
        <button type="button" class="btn-dismiss" @click="emit('dismiss')">
          Другая клетка
        </button>
      </footer>
    </template>
  </aside>
</template>

<style scoped>
.combat-preview {
  position: absolute;
  bottom: 1rem;
  right: 0.75rem;
  z-index: 48;
  width: min(92vw, 400px);
  max-height: min(55vh, 420px);
  overflow-y: auto;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  border: 1px solid rgba(248, 113, 113, 0.55);
  background: rgba(69, 10, 10, 0.94);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  color: #fecaca;
}
.combat-preview--collapsed {
  width: auto;
  max-width: min(92vw, 420px);
  max-height: none;
  overflow: visible;
  padding: 0.45rem 0.65rem;
}
.combat-preview--dragging {
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.55);
}
.combat-preview__head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-bottom: 0.35rem;
}
.combat-preview--collapsed .combat-preview__head {
  margin-bottom: 0.2rem;
}
.combat-preview__head--drag {
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.combat-preview--dragging .combat-preview__head--drag {
  cursor: grabbing;
}
.combat-preview__title {
  margin: 0;
  font-size: 0.9rem;
  color: #fff;
}
.combat-preview__coord {
  font-size: 0.75rem;
  color: #fca5a5;
}
.combat-preview__collapse,
.combat-preview__close {
  border: none;
  background: transparent;
  color: #fca5a5;
  font-size: 1rem;
  cursor: pointer;
  line-height: 1;
  padding: 0.1rem 0.25rem;
  border-radius: 4px;
}
.combat-preview__collapse:hover,
.combat-preview__close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.combat-preview__collapse {
  margin-left: auto;
}
.combat-preview__close {
  font-size: 1.2rem;
}
.combat-preview__compact {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.combat-preview__compact-sep {
  color: #94a3b8;
}
.combat-preview__compact--win { color: #86efac; }
.combat-preview__compact--draw { color: #fde68a; }
.combat-preview__compact--defeat { color: #fca5a5; }
.combat-preview__compact--muted {
  color: #94a3b8;
}
.combat-preview__lead {
  margin: 0 0 0.55rem;
  font-size: 0.78rem;
  color: #fed7d7;
  line-height: 1.35;
}
.combat-preview__sides {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.45rem;
  margin-bottom: 0.55rem;
}
.side {
  padding: 0.4rem 0.45rem;
  border-radius: 8px;
  font-size: 0.76rem;
}
.side h4 {
  margin: 0 0 0.3rem;
  font-size: 0.72rem;
  font-weight: 600;
}
.side--attacker {
  background: rgba(127, 29, 29, 0.5);
  border: 1px solid rgba(248, 113, 113, 0.35);
}
.side--defender {
  background: rgba(30, 58, 138, 0.45);
  border: 1px solid rgba(96, 165, 250, 0.35);
}
.side--defender h4 {
  color: #bfdbfe;
}
.ship-chips {
  margin: 0 0 0.25rem;
  padding: 0;
  list-style: none;
}
.ship-chips li {
  margin-bottom: 0.1rem;
}
.dice-line {
  margin: 0.2rem 0 0;
  font-size: 0.72rem;
  color: #fecaca;
}
.muted {
  color: #94a3b8;
  font-size: 0.7rem;
}
.dice-breakdown {
  margin: 0.2rem 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.68rem;
  line-height: 1.35;
  color: #fed7aa;
}
.dice-breakdown li:last-child {
  margin-top: 0.1rem;
  color: #fff;
  font-weight: 600;
}
.round-damage {
  margin-bottom: 0.45rem;
  padding: 0.45rem 0.5rem;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.28);
}
.round-damage h4 {
  margin: 0 0 0.35rem;
  font-size: 0.72rem;
  color: #fff;
}
.round-damage__stats {
  display: grid;
  gap: 0.3rem;
}
.round-damage__stat {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0;
}
.round-damage__label {
  font-size: 0.72rem;
  color: #fed7d7;
}
.round-damage__value {
  font-size: 1.05rem;
  font-weight: 700;
  white-space: nowrap;
}
.round-damage__stat--deal .round-damage__value { color: #86efac; }
.round-damage__stat--take .round-damage__value { color: #fca5a5; }
.round-damage__warn {
  margin: 0.35rem 0 0;
  font-size: 0.68rem;
  line-height: 1.35;
  color: #fde68a;
}
.round-odds {
  margin-bottom: 0.55rem;
  padding: 0.4rem 0.45rem;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  font-size: 0.76rem;
}
.round-odds__toggle {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.round-odds h4 {
  margin: 0 0 0.35rem;
  font-size: 0.72rem;
  color: #fff;
}
.odds-bars {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.odds-row {
  display: grid;
  grid-template-columns: 4.5rem 1fr 2.2rem;
  align-items: center;
  gap: 0.35rem;
}
.odds-label {
  font-size: 0.68rem;
  font-weight: 600;
}
.odds-label--win { color: #86efac; }
.odds-label--draw { color: #fde68a; }
.odds-label--defeat { color: #fca5a5; }
.odds-track {
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}
.odds-fill {
  height: 100%;
  border-radius: 3px;
  min-width: 2px;
}
.odds-fill--win { background: #22c55e; }
.odds-fill--draw { background: #eab308; }
.odds-fill--defeat { background: #ef4444; }
.odds-pct {
  font-size: 0.68rem;
  text-align: right;
  color: #fecaca;
}
.odds-note {
  margin: 0.3rem 0 0;
  line-height: 1.35;
  font-size: 0.65rem;
  color: #94a3b8;
}
.combat-preview__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.35rem;
}
.btn-battle,
.btn-dismiss {
  padding: 0.35rem 0.6rem;
  border-radius: 6px;
  font-size: 0.76rem;
  cursor: pointer;
}
.btn-battle {
  border: 1px solid #dc2626;
  background: #991b1b;
  color: #fff;
  font-weight: 600;
}
.btn-dismiss {
  border: 1px solid #475569;
  background: #334155;
  color: #e2e8f0;
}
</style>
