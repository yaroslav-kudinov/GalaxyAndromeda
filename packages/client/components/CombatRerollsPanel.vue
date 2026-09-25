<script setup lang="ts">
/**
 * Перебросы гарнизона осаждённой клетки (ADR 019): раунд брошен, осаждённый перебрасывает
 * свои промахи по одному и видит каждый результат. Остальные видят броски и ждут.
 */
import type { GameSnapshot, RolledCombatDie } from '@galaxy/rules'
import { buildCombatPreviewFromPending, canRerollDie, SHIP_LABELS } from '@galaxy/rules'
import { useUiStrings } from '~/i18n/ui-strings'

const props = defineProps<{
  snapshot: GameSnapshot
  playerId: string
  playerNames?: Record<string, string>
  busy?: boolean
}>()

const emit = defineEmits<{
  reroll: [dieIndex: number]
  finish: [auto: boolean]
}>()

const t = useUiStrings().combatRerolls

const pending = computed(() =>
  props.snapshot.pendingCombat?.phase === 'awaiting-rerolls' ? props.snapshot.pendingCombat : null,
)
const rerolls = computed(() => pending.value?.rolledRound.rerolls ?? null)
const isMine = computed(() => rerolls.value?.playerId === props.playerId)

const typeById = computed(() => {
  const map = new Map<string, string>()
  for (const cell of props.snapshot.cells) for (const ship of cell.ships) map.set(ship.id, ship.type)
  return map
})

interface DieView {
  die: RolledCombatDie
  index: number
}

/** Кубики по стреляющим: сначала гарнизон осаждённого, потом остальные. */
const groups = computed(() => {
  const dice = pending.value?.rolledRound.dice ?? []
  const byShooter = new Map<string, DieView[]>()
  dice.forEach((die, index) => {
    const list = byShooter.get(die.shooterShipId) ?? []
    list.push({ die, index })
    byShooter.set(die.shooterShipId, list)
  })
  const owner = rerolls.value?.playerId
  return [...byShooter.values()].sort(
    (a, b) => Number(b[0]!.die.ownerId === owner) - Number(a[0]!.die.ownerId === owner),
  )
})

/**
 * Корабли на клетке боя: урон до раунда и попадания этого броска — чтобы было видно, какой
 * промах стоит перебросить.
 */
const shipsInBattle = computed(() => {
  const preview = pending.value ? buildCombatPreviewFromPending(props.snapshot) : null
  if (!preview) return []
  const hitsNow = new Map<string, number>()
  for (const die of pending.value?.rolledRound.dice ?? []) {
    if (die.targetShipId && die.value >= die.threshold) {
      hitsNow.set(die.targetShipId, (hitsNow.get(die.targetShipId) ?? 0) + 1)
    }
  }
  return [...preview.attacker.ships, ...preview.defender.ships].map((ship) => {
    const before = Math.min(ship.hull, ship.damage)
    const now = Math.min(ship.hull - before, hitsNow.get(ship.shipId) ?? 0)
    return {
      id: ship.shipId,
      type: ship.type,
      ownerId: ship.ownerId,
      hull: ship.hull,
      before,
      now,
      destroyed: before + now >= ship.hull,
      pips: Array.from({ length: ship.hull }, (_, i) =>
        i < before ? 'lost' : i < before + now ? 'hit' : 'alive'),
    }
  })
})

/** Подпись корабля: одинаковые классы одного игрока нумеруются — «Крейсер 1», «Крейсер 2». */
const shipLabelById = computed(() => {
  const labels = new Map<string, { full: string; short: string }>()
  const counts = new Map<string, number>()
  for (const ship of shipsInBattle.value) {
    const key = `${ship.ownerId}:${ship.type}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  for (const ship of shipsInBattle.value) {
    const key = `${ship.ownerId}:${ship.type}`
    const name = shipName(ship.type)
    if ((counts.get(key) ?? 0) > 1) {
      const n = (seen.get(key) ?? 0) + 1
      seen.set(key, n)
      labels.set(ship.id, { full: `${name} ${n}`, short: `${name.slice(0, 3)}${n}` })
    } else {
      labels.set(ship.id, { full: name, short: name.slice(0, 3) })
    }
  }
  return labels
})

function playerColor(id: string): string {
  return props.snapshot.players.find((player) => player.id === id)?.color ?? '#94a3b8'
}

function shipName(type: string): string {
  return SHIP_LABELS[type as keyof typeof SHIP_LABELS] ?? type
}

function targetName(id: string | null): string {
  if (!id) return t.noTarget
  return shipLabelById.value.get(id)?.full ?? shipName(typeById.value.get(id) ?? '')
}

function targetShort(id: string | null): string {
  if (!id) return '—'
  return shipLabelById.value.get(id)?.short ?? targetName(id).slice(0, 3)
}
</script>

<template>
  <section v-if="pending && rerolls" class="cr" role="dialog" :aria-label="t.heading">
    <header class="cr-head">
      <strong>{{ t.heading(pending.roundNumber) }}</strong>
      <span class="cr-left">{{ t.left(rerolls.left) }}</span>
    </header>
    <p class="cr-sub">
      {{ isMine ? t.mineHint : t.waiting(playerNames?.[rerolls.playerId] ?? rerolls.playerId) }}
    </p>

    <ul class="cr-ships">
      <li
        v-for="ship in shipsInBattle"
        :key="ship.id"
        class="cr-ship-card"
        :class="{ 'cr-ship-card--dead': ship.destroyed }"
        :style="{ '--owner': playerColor(ship.ownerId) }"
        :title="t.shipTitle(shipName(ship.type), ship.before, ship.now, ship.hull)"
      >
        <BattleShipSprite
          class="cr-sprite"
          :type="ship.type"
          :color="playerColor(ship.ownerId)"
          :hull="ship.hull"
          :damage="ship.before + ship.now"
          :destroyed="ship.destroyed"
          :width="24"
        />
        <span class="cr-ship-name">{{ shipLabelById.get(ship.id)?.full ?? shipName(ship.type) }}</span>
        <span class="cr-pips" aria-hidden="true">
          <span v-for="(pip, i) in ship.pips" :key="i" class="cr-pip" :class="`cr-pip--${pip}`" />
        </span>
        <span v-if="ship.destroyed" class="cr-dead">{{ t.destroyed }}</span>
        <span v-else-if="ship.now" class="cr-hitnow">{{ t.hitsNow(ship.now) }}</span>
      </li>
    </ul>

    <ul class="cr-list">
      <li
        v-for="group in groups"
        :key="group[0]!.die.shooterShipId"
        class="cr-row"
        :style="{ '--owner': playerColor(group[0]!.die.ownerId) }"
      >
        <span class="cr-ship">
          {{ shipLabelById.get(group[0]!.die.shooterShipId)?.full ?? shipName(group[0]!.die.shooterType) }}
          <span v-if="group[0]!.die.distance > 0" class="cr-muted">{{ t.support }}</span>
        </span>
        <span class="cr-dice">
          <button
            v-for="view in group"
            :key="view.index"
            type="button"
            class="cr-die"
            :class="{
              'cr-die--hit': view.die.value >= view.die.threshold && view.die.targetShipId,
              'cr-die--can': isMine && canRerollDie(view.die) && rerolls.left > 0,
            }"
            :disabled="busy || !isMine || !canRerollDie(view.die) || rerolls.left <= 0"
            :title="t.dieTitle(view.die.value, view.die.threshold, targetName(view.die.targetShipId), view.die.history)"
            @click="emit('reroll', view.index)"
          >
            <span class="cr-value">{{ view.die.value }}</span>
            <span class="cr-need">{{ view.die.threshold }}+</span>
            <span v-if="view.die.history.length" class="cr-history">{{ view.die.history.join('→') }}</span>
            <span class="cr-target">→ {{ targetShort(view.die.targetShipId) }}</span>
          </button>
        </span>
      </li>
    </ul>

    <footer v-if="isMine" class="cr-foot">
      <button type="button" class="cr-secondary" :disabled="busy" @click="emit('finish', true)">
        {{ t.auto }}
      </button>
      <button type="button" class="cr-primary" :disabled="busy" @click="emit('finish', false)">
        {{ t.done }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.cr {
  position: absolute;
  top: calc(var(--hud-header-height, 3rem) + 0.5rem);
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  width: min(92vw, 540px);
  max-height: 72vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 0.9rem;
  border-radius: 12px;
  border: 1px solid rgba(248, 113, 113, 0.6);
  background: rgba(15, 23, 42, 0.96);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  color: #e2e8f0;
}
.cr-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}
.cr-head strong {
  color: #fca5a5;
}
.cr-left {
  margin-left: auto;
  font-weight: 700;
  color: #fcd34d;
  font-variant-numeric: tabular-nums;
}
.cr-sub {
  margin: 0;
  font-size: 0.78rem;
  color: #94a3b8;
}
.cr-ships {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.cr-ship-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  min-width: 4.6rem;
  padding: 0.3rem 0.4rem;
  border-radius: 8px;
  border: 1px solid var(--owner);
  background: rgba(30, 41, 59, 0.7);
  font-size: 0.72rem;
}
.cr-ship-card--dead {
  border-style: dashed;
  opacity: 0.75;
}
.cr-ship-name {
  font-weight: 600;
}
.cr-pips {
  display: inline-flex;
  gap: 0.18rem;
}
.cr-pip {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
}
.cr-pip--alive {
  background: #4ade80;
}
.cr-pip--lost {
  background: #7f1d1d;
}
.cr-pip--hit {
  background: #f97316;
  box-shadow: 0 0 0 1px #fdba74;
}
.cr-dead {
  color: #fca5a5;
  font-weight: 700;
  font-size: 0.65rem;
}
.cr-hitnow {
  color: #fdba74;
  font-size: 0.65rem;
}
.cr-target {
  position: absolute;
  bottom: -0.8rem;
  font-size: 0.5rem;
  color: #94a3b8;
  white-space: nowrap;
}
.cr-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.cr-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.3rem 0.4rem 0.95rem;
  border-left: 3px solid var(--owner);
  border-radius: 6px;
  background: rgba(30, 41, 59, 0.6);
}
.cr-ship {
  min-width: 7rem;
  font-size: 0.8rem;
  font-weight: 600;
}
.cr-muted {
  font-weight: 400;
  color: #94a3b8;
  font-size: 0.7rem;
}
.cr-dice {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.cr-die {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 2.3rem;
  height: 2.3rem;
  padding: 0;
  border-radius: 7px;
  border: 2px solid #475569;
  background: #1e293b;
  color: #e2e8f0;
  cursor: default;
}
.cr-die--hit {
  border-color: #4ade80;
  background: rgba(20, 83, 45, 0.55);
}
.cr-die--can {
  border-color: #fbbf24;
  cursor: pointer;
  box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.25);
}
.cr-die--can:hover:not(:disabled) {
  background: rgba(180, 83, 9, 0.45);
}
.cr-value {
  font-size: 0.95rem;
  font-weight: 800;
  line-height: 1;
}
.cr-need {
  font-size: 0.5rem;
  color: #94a3b8;
}
.cr-history {
  position: absolute;
  top: -0.55rem;
  right: -0.35rem;
  font-size: 0.5rem;
  padding: 0 0.15rem;
  border-radius: 3px;
  background: #334155;
  color: #cbd5e1;
}
.cr-foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}
.cr-primary,
.cr-secondary {
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
  font-size: 0.8rem;
  cursor: pointer;
}
.cr-primary {
  border: 1px solid #fbbf24;
  background: #b45309;
  color: #fff;
  font-weight: 600;
}
.cr-secondary {
  border: 1px solid rgba(148, 163, 184, 0.5);
  background: transparent;
  color: inherit;
}
</style>
