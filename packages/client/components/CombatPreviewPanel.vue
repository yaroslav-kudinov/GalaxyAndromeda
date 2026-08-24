<script setup lang="ts">
import type { CombatPreview, RoundOneOutcomeOdds, ShieldContribution } from '@galaxy/rules'
import { SHIP_LABELS, formatShieldContributionLabel, getShieldAbsorbCapacity } from '@galaxy/rules'

const props = defineProps<{
  preview: CombatPreview
  playerNames?: Record<string, string>
  roundOneOdds?: RoundOneOutcomeOdds | null
  /** Показать кнопку «Разрешение боя» (после подтверждения приказа) */
  showBattleAction?: boolean
}>()

const panelTitle = computed(() =>
  props.preview.trigger === 'bombardment' ? 'Превью обстрела' : 'Превью боя',
)

const leadText = computed(() => {
  if (props.preview.trigger === 'bombardment') {
    return 'Обстрел по цели добавлен в приказ. Защитник не бросает кубики — очки уничтожения = сумма обстрела.'
  }
  return 'Ход на эту клетку добавлен в приказ. Ниже — черновик первого раунда по rulebook.'
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
    collapsed.value = sessionStorage.getItem(COLLAPSED_STORAGE_KEY) === '1'
  }
})

function toggleCollapsed() {
  collapsed.value = !collapsed.value
  if (import.meta.client) {
    sessionStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed.value ? '1' : '0')
  }
}

function playerLabel(id: string): string {
  return props.playerNames?.[id] ?? id
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function shieldOnCellLabel(shipId: string): string | null {
  const sh = props.preview.shieldContributions.find((c) => c.shipId === shipId && c.scope === 'self')
  if (!sh) return null
  return formatShieldContributionLabel(sh)
}

function neighborShieldEntries(): ShieldContribution[] {
  return props.preview.shieldContributions.filter((c) => c.scope === 'neighbor')
}

const oddsSummaryParts = computed(() => {
  const odds = props.roundOneOdds
  if (!odds) return null
  if (isBombardment.value) {
    return [{ label: 'Урон', value: 'сумма обстрела', tone: 'win' as const }]
  }
  return [
    { label: 'Победа', value: pct(odds.win), tone: 'win' as const },
    { label: 'Ничья', value: pct(odds.draw), tone: 'draw' as const },
    { label: 'Поражение', value: pct(odds.defeat), tone: 'defeat' as const },
  ]
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

    <p v-if="collapsed && oddsSummaryParts" class="combat-preview__compact">
      <template v-for="(part, index) in oddsSummaryParts" :key="part.tone">
        <span v-if="index > 0" class="combat-preview__compact-sep"> · </span>
        <span :class="`combat-preview__compact--${part.tone}`">{{ part.label }} {{ part.value }}</span>
      </template>
    </p>
    <p v-else-if="collapsed" class="combat-preview__compact combat-preview__compact--muted">
      Оценка 1-го раунда недоступна
    </p>

    <template v-if="!collapsed">
      <p class="combat-preview__lead">
        {{ leadText }}
      </p>

      <section v-if="roundOneOdds && preview.trigger !== 'bombardment'" class="round-odds">
        <h4>1-й раунд (оценка)</h4>
        <div class="odds-bars">
          <div class="odds-row">
            <span class="odds-label odds-label--win">Победа</span>
            <div class="odds-track">
              <div class="odds-fill odds-fill--win" :style="{ width: pct(roundOneOdds.win) }" />
            </div>
            <span class="odds-pct">{{ pct(roundOneOdds.win) }}</span>
          </div>
          <div class="odds-row">
            <span class="odds-label odds-label--draw">Ничья</span>
            <div class="odds-track">
              <div class="odds-fill odds-fill--draw" :style="{ width: pct(roundOneOdds.draw) }" />
            </div>
            <span class="odds-pct">{{ pct(roundOneOdds.draw) }}</span>
          </div>
          <div class="odds-row">
            <span class="odds-label odds-label--defeat">Поражение</span>
            <div class="odds-track">
              <div class="odds-fill odds-fill--defeat" :style="{ width: pct(roundOneOdds.defeat) }" />
            </div>
            <span class="odds-pct">{{ pct(roundOneOdds.defeat) }}</span>
          </div>
        </div>
        <p class="odds-note">Monte-Carlo через rollCombatRound (по кораблю); щиты не учтены.</p>
      </section>

      <div class="combat-preview__sides">
        <section class="side side--attacker">
          <h4>Атакующий · {{ playerLabel(preview.attackerId) }}</h4>
          <ul class="ship-chips">
            <li v-for="s in preview.attacker.ships" :key="s.shipId">
              {{ SHIP_LABELS[s.type] }}
            </li>
            <li v-if="!preview.attacker.ships.length" class="muted">
              {{ preview.trigger === 'bombardment' ? 'корабли обстрела' : 'корабли из хода' }}
            </li>
          </ul>
          <p class="dice-line">
            <template v-if="preview.trigger === 'bombardment'">
              Кубики обстрела: {{ preview.attacker.supportDiceTotal }}d6
            </template>
            <template v-else>
              Кубики: {{ preview.attacker.combatDiceTotal }} боевых
              <span v-if="preview.attacker.supportDiceTotal"> + {{ preview.attacker.supportDiceTotal }} поддержки</span>
            </template>
          </p>
          <ul v-if="preview.attacker.supportingShips.length" class="support-list">
            <li v-for="sup in preview.attacker.supportingShips" :key="sup.shipId">
              {{ preview.trigger === 'bombardment' ? 'Обстрел' : 'Поддержка' }}:
              {{ SHIP_LABELS[sup.type] }} · +{{ sup.supportDice }}d6
              <span class="muted">({{ sup.fromCoord.q }}, {{ sup.fromCoord.r }})</span>
            </li>
          </ul>
        </section>

        <section class="side side--defender">
          <h4>Защитник · {{ playerLabel(preview.defenderId) }}</h4>
          <ul class="ship-chips">
            <li
              v-for="s in preview.defender.ships"
              :key="s.shipId"
              :class="{ 'ship-chip--shield': s.type === 'shield' }"
            >
              <template v-if="s.type === 'shield'">
                {{ shieldOnCellLabel(s.shipId) ?? `щит · до ${getShieldAbsorbCapacity('self')} на клетке` }}
              </template>
              <template v-else>
                {{ SHIP_LABELS[s.type] }}
              </template>
            </li>
          </ul>
          <ul v-if="neighborShieldEntries().length" class="support-list support-list--shield">
            <li v-for="sh in neighborShieldEntries()" :key="sh.shipId">
              {{ formatShieldContributionLabel(sh) }}
              <span class="muted">({{ sh.fromCoord.q }}, {{ sh.fromCoord.r }})</span>
            </li>
          </ul>
          <p v-if="preview.trigger === 'bombardment'" class="dice-line muted">
            Не бросает кубики (обстрел) — только щиты и цели уничтожения
          </p>
          <template v-else>
            <p class="dice-line">
              Кубики: {{ preview.defender.combatDiceTotal }} боевых
              <span v-if="preview.defender.supportDiceTotal"> + {{ preview.defender.supportDiceTotal }} поддержки</span>
            </p>
            <ul v-if="preview.defender.supportingShips.length" class="support-list">
              <li v-for="sup in preview.defender.supportingShips" :key="sup.shipId">
                Поддержка: {{ SHIP_LABELS[sup.type] }} · +{{ sup.supportDice }}d6
                <span class="muted">({{ sup.fromCoord.q }}, {{ sup.fromCoord.r }})</span>
              </li>
            </ul>
          </template>
        </section>
      </div>

      <section v-if="preview.shieldContributions.length" class="shields">
        <h4>Щиты</h4>
        <ul class="shield-list">
          <li v-for="sh in preview.shieldContributions" :key="sh.shipId">
            <span class="shield-pips" :title="`Поглощение до ${sh.absorbCapacity}`">
              <span
                v-for="n in sh.absorbCapacity"
                :key="n"
                class="pip"
                :class="{ 'pip--neighbor': sh.scope === 'neighbor' }"
              />
            </span>
            {{ formatShieldContributionLabel(sh) }}
            <span class="muted">({{ sh.fromCoord.q }}, {{ sh.fromCoord.r }})</span>
          </li>
        </ul>
        <p class="shield-total">Суммарно до {{ preview.shieldAbsorbTotal }} (пример 4+2)</p>
      </section>

      <section class="priority">
        <h4>Приоритет уничтожения</h4>
        <p class="priority-order">{{ preview.destructionOrder.map((t) => SHIP_LABELS[t]).join(' → ') }}</p>
        <p class="priority-note">
          Priority skip — бесплатное объявление по типу корабля (все экземпляры на гексе). Атакующий и защитник выбирают skip в модалке боя.
        </p>
      </section>

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
.ship-chip--shield {
  color: #86efac;
  font-weight: 600;
}
.support-list--shield {
  color: #86efac;
}
.dice-line {
  margin: 0;
  font-size: 0.72rem;
  color: #fecaca;
}
.support-list {
  margin: 0.2rem 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.68rem;
  color: #fed7aa;
}
.support-list li {
  margin-bottom: 0.1rem;
}
.shields,
.priority {
  margin-bottom: 0.5rem;
  font-size: 0.76rem;
}
.shields h4,
.priority h4 {
  margin: 0 0 0.25rem;
  font-size: 0.72rem;
  color: #fff;
}
.shield-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.shield-list li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-bottom: 0.2rem;
}
.shield-pips {
  display: inline-flex;
  gap: 2px;
}
.pip {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 4px rgba(74, 222, 128, 0.6);
}
.pip--neighbor {
  background: #86efac;
  opacity: 0.85;
}
.shield-total {
  margin: 0.25rem 0 0;
  font-size: 0.72rem;
  color: #bbf7d0;
}
.priority-order {
  margin: 0 0 0.2rem;
  font-size: 0.72rem;
  line-height: 1.3;
}
.priority-skip {
  margin: 0;
  font-size: 0.72rem;
}
.priority-note {
  margin: 0.25rem 0 0;
  font-size: 0.68rem;
  color: #94a3b8;
  line-height: 1.3;
}
.muted {
  color: #94a3b8;
  font-size: 0.7rem;
}
.round-odds {
  margin-bottom: 0.55rem;
  padding: 0.4rem 0.45rem;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  font-size: 0.76rem;
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
