<script setup lang="ts">
/**
 * Распределение кубиков по целям на один раунд боя.
 *
 * Четыре строки: вражеские корабли, счётчик попаданий каждого, распределитель кубиков на
 * каждый корабль и внизу — кубики игрока. Выбор живёт один раунд: к следующему раунду урон
 * меняется, и цели выбираются заново.
 */
import type { CombatPreview, ShipType } from '@galaxy/rules'
import {
  autoDiceTargetsFor,
  hitProbability,
  playerCombatDice,
  playerCombatTargets,
  SHIP_LABELS,
} from '@galaxy/rules'
import { useUiStrings } from '~/i18n/ui-strings'

const props = defineProps<{
  preview: CombatPreview
  playerId: string
  playerColor: string
  enemyColor: string
  roundNumber: number
  /** Урон, накопленный в бою к началу раунда. */
  damageByShipId?: Readonly<Record<string, number>>
  disabled?: boolean
}>()

/** id стреляющего → id цели для каждого его кубика по порядку; '' — цель выберет игра. */
const model = defineModel<Record<string, string[]>>({ required: true })

const t = useUiStrings().combatTargets

const dice = computed(() => playerCombatDice(props.preview, props.playerId))
const targets = computed(() =>
  playerCombatTargets(props.preview, props.playerId, props.damageByShipId ?? {}),
)
const targetById = computed(() => new Map(targets.value.map((target) => [target.shipId, target])))

/** Ключ кубика: стреляющий и номер его кубика. */
function dieKey(shooterShipId: string, index: number): string {
  return `${shooterShipId}#${index}`
}

const assignment = computed((): Map<string, string | null> => {
  const out = new Map<string, string | null>()
  for (const die of dice.value) {
    const wanted = model.value[die.shooterShipId]?.[die.index] ?? ''
    out.set(dieKey(die.shooterShipId, die.index), wanted && targetById.value.has(wanted) ? wanted : null)
  }
  return out
})

const selectedKey = ref<string | null>(null)

function writeAssignment(next: Map<string, string | null>) {
  const out: Record<string, string[]> = {}
  for (const die of dice.value) {
    const list = (out[die.shooterShipId] ??= [])
    list[die.index] = next.get(dieKey(die.shooterShipId, die.index)) ?? ''
  }
  model.value = out
}

const freeDice = computed(() =>
  dice.value.filter((die) => assignment.value.get(dieKey(die.shooterShipId, die.index)) == null),
)

function diceOn(targetId: string) {
  return dice.value.filter((die) => assignment.value.get(dieKey(die.shooterShipId, die.index)) === targetId)
}

function expectedOn(targetId: string): number {
  return diceOn(targetId).reduce((sum, die) => sum + hitProbability(die.threshold), 0)
}

function addDie(targetId: string) {
  if (props.disabled) return
  const selected = selectedKey.value
    ? freeDice.value.find((die) => dieKey(die.shooterShipId, die.index) === selectedKey.value)
    : undefined
  // Без выбранного кубика берём самый точный из свободных.
  const die = selected ?? [...freeDice.value].sort((a, b) => a.threshold - b.threshold)[0]
  if (!die) return
  const next = new Map(assignment.value)
  next.set(dieKey(die.shooterShipId, die.index), targetId)
  selectedKey.value = null
  writeAssignment(next)
}

function removeDie(targetId: string) {
  if (props.disabled) return
  // Возвращаем самый неточный: точные кубики полезнее оставить на цели.
  const die = [...diceOn(targetId)].sort((a, b) => b.threshold - a.threshold)[0]
  if (!die) return
  const next = new Map(assignment.value)
  next.set(dieKey(die.shooterShipId, die.index), null)
  writeAssignment(next)
}

function onDieClick(shooterShipId: string, index: number) {
  if (props.disabled) return
  const key = dieKey(shooterShipId, index)
  if (assignment.value.get(key) != null) {
    const next = new Map(assignment.value)
    next.set(key, null)
    writeAssignment(next)
    return
  }
  selectedKey.value = selectedKey.value === key ? null : key
}

function applyAuto() {
  if (props.disabled) return
  selectedKey.value = null
  model.value = autoDiceTargetsFor(props.preview, props.playerId, props.damageByShipId ?? {})
}

function clearAll() {
  if (props.disabled) return
  selectedKey.value = null
  writeAssignment(new Map())
}

function shipLabel(type: ShipType): string {
  return SHIP_LABELS[type]
}

function targetShort(targetId: string | null | undefined): string {
  if (!targetId) return ''
  const target = targetById.value.get(targetId)
  return target ? SHIP_LABELS[target.type].slice(0, 3) : ''
}

function hullPips(hull: number, damage: number): boolean[] {
  return Array.from({ length: hull }, (_, i) => i < hull - damage)
}
</script>

<template>
  <section
    class="ct"
    :class="{ 'ct--disabled': disabled }"
    :style="{ '--mine': playerColor, '--enemy': enemyColor }"
  >
    <header class="ct-head">
      <strong>{{ t.heading(roundNumber) }}</strong>
      <span class="ct-count" :class="{ 'ct-count--done': freeDice.length === 0 }">
        {{ freeDice.length ? t.diceLeft(freeDice.length, dice.length) : t.allAssigned }}
      </span>
      <span class="ct-tools">
        <button type="button" class="ct-tool" :title="t.autoHint" :disabled="disabled" @click="applyAuto">
          {{ t.auto }}
        </button>
        <button type="button" class="ct-tool" :disabled="disabled" @click="clearAll">{{ t.clear }}</button>
      </span>
    </header>

    <p v-if="!dice.length" class="ct-empty">{{ t.noDice }}</p>
    <p v-else-if="!targets.length" class="ct-empty">{{ t.noTargets }}</p>
    <template v-else>
      <div class="ct-grid" :style="{ gridTemplateColumns: `repeat(${targets.length}, minmax(4.6rem, 1fr))` }">
        <!-- 1. Вражеские корабли -->
        <div v-for="target in targets" :key="`ship-${target.shipId}`" class="ct-cell ct-ship">
          <svg class="ct-glyph" viewBox="-14 -14 28 28" aria-hidden="true">
            <ShipGlyph :type="target.type" :player-color="enemyColor" :scale="0.9" />
          </svg>
          <span class="ct-ship-name">{{ shipLabel(target.type) }}</span>
        </div>

        <!-- 2. Счётчик попаданий -->
        <div
          v-for="target in targets"
          :key="`hits-${target.shipId}`"
          class="ct-cell ct-hits"
          :title="t.hits(target.damage, target.hull)"
        >
          <span class="ct-pips" aria-hidden="true">
            <span
              v-for="(alive, i) in hullPips(target.hull, target.damage)"
              :key="i"
              class="ct-pip"
              :class="{ 'ct-pip--lost': !alive }"
            />
          </span>
          <span class="ct-expected" :class="{ 'ct-expected--kill': expectedOn(target.shipId) >= target.hull - target.damage }">
            {{ t.expected(expectedOn(target.shipId).toFixed(1)) }}
          </span>
        </div>

        <!-- 3. Распределитель -->
        <div v-for="target in targets" :key="`alloc-${target.shipId}`" class="ct-cell ct-alloc">
          <div class="ct-stepper">
            <button
              type="button"
              class="ct-step"
              :aria-label="t.remove"
              :disabled="disabled || !diceOn(target.shipId).length"
              @click="removeDie(target.shipId)"
            >
              −
            </button>
            <span class="ct-step-value">{{ diceOn(target.shipId).length }}</span>
            <button
              type="button"
              class="ct-step"
              :aria-label="t.add"
              :disabled="disabled || !freeDice.length"
              @click="addDie(target.shipId)"
            >
              +
            </button>
          </div>
          <span class="ct-assigned">
            <span
              v-for="die in diceOn(target.shipId)"
              :key="`${die.shooterShipId}#${die.index}`"
              class="ct-mini"
            >{{ t.needs(die.threshold) }}</span>
          </span>
        </div>
      </div>

      <!-- 4. Кубики игрока -->
      <div class="ct-pool" role="list">
        <button
          v-for="die in dice"
          :key="`${die.shooterShipId}#${die.index}`"
          type="button"
          role="listitem"
          class="ct-die"
          :class="{
            'ct-die--assigned': assignment.get(`${die.shooterShipId}#${die.index}`) != null,
            'ct-die--selected': selectedKey === `${die.shooterShipId}#${die.index}`,
            'ct-die--support': die.distance > 0,
          }"
          :disabled="disabled"
          :title="t.dieTitle(
            shipLabel(die.type) + (die.distance > 0 ? ` (${t.support})` : ''),
            die.threshold,
            targetShort(assignment.get(`${die.shooterShipId}#${die.index}`)) || null,
          )"
          @click="onDieClick(die.shooterShipId, die.index)"
        >
          <span class="ct-die-face">{{ t.needs(die.threshold) }}</span>
          <span class="ct-die-owner">{{ shipLabel(die.type).slice(0, 3) }}</span>
          <span v-if="assignment.get(`${die.shooterShipId}#${die.index}`)" class="ct-die-target">
            → {{ targetShort(assignment.get(`${die.shooterShipId}#${die.index}`)) }}
          </span>
        </button>
      </div>
      <p class="ct-hint">{{ freeDice.length ? t.freeGoAuto : t.pickDieHint }}</p>
    </template>
  </section>
</template>

<style scoped>
.ct {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem 0.7rem;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(2, 6, 23, 0.5);
}
.ct--disabled {
  opacity: 0.65;
}
.ct-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}
.ct-count {
  color: #fbbf24;
  font-variant-numeric: tabular-nums;
}
.ct-count--done {
  color: #4ade80;
}
.ct-tools {
  margin-left: auto;
  display: inline-flex;
  gap: 0.3rem;
}
.ct-tool {
  font-size: 0.72rem;
  padding: 0.15rem 0.5rem;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.ct-tool:disabled {
  cursor: default;
  opacity: 0.5;
}
.ct-empty {
  margin: 0;
  font-size: 0.8rem;
  color: #94a3b8;
}
.ct-grid {
  display: grid;
  gap: 0.25rem 0.4rem;
  overflow-x: auto;
}
.ct-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  min-width: 0;
}
.ct-ship {
  padding: 0.3rem 0.2rem 0.15rem;
  border-radius: 8px 8px 0 0;
  border: 1px solid color-mix(in srgb, var(--enemy) 55%, transparent);
  border-bottom: none;
  background: color-mix(in srgb, var(--enemy) 10%, transparent);
}
.ct-glyph {
  width: 1.9rem;
  height: 1.9rem;
}
.ct-ship-name {
  font-size: 0.7rem;
  font-weight: 600;
  white-space: nowrap;
}
.ct-hits {
  padding: 0.2rem;
  border-left: 1px solid color-mix(in srgb, var(--enemy) 55%, transparent);
  border-right: 1px solid color-mix(in srgb, var(--enemy) 55%, transparent);
}
.ct-pips {
  display: inline-flex;
  gap: 0.18rem;
}
.ct-pip {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: #4ade80;
}
.ct-pip--lost {
  background: #7f1d1d;
}
.ct-expected {
  font-size: 0.66rem;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}
.ct-expected--kill {
  color: #fca5a5;
  font-weight: 700;
}
.ct-alloc {
  padding: 0.25rem 0.2rem 0.35rem;
  border-radius: 0 0 8px 8px;
  border: 1px solid color-mix(in srgb, var(--enemy) 55%, transparent);
  border-top: none;
}
.ct-stepper {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.ct-step {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--mine) 70%, transparent);
  background: color-mix(in srgb, var(--mine) 18%, transparent);
  color: inherit;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
}
.ct-step:disabled {
  opacity: 0.35;
  cursor: default;
}
.ct-step-value {
  min-width: 1.2rem;
  text-align: center;
  font-weight: 800;
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
}
.ct-assigned {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.15rem;
  min-height: 0.9rem;
}
.ct-mini {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 0 0.2rem;
  border-radius: 3px;
  background: color-mix(in srgb, var(--mine) 35%, #0f172a);
  color: #f8fafc;
}
.ct-pool {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding-top: 0.45rem;
  border-top: 1px dashed rgba(148, 163, 184, 0.35);
}
/* Кубик: грань d6 в цвете игрока с нужным значением. */
.ct-die {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 2.35rem;
  height: 2.35rem;
  padding: 0;
  border-radius: 7px;
  border: 2px solid var(--mine);
  background:
    radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.18), transparent 55%),
    color-mix(in srgb, var(--mine) 28%, #0f172a);
  box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.35);
  color: #f8fafc;
  cursor: pointer;
}
.ct-die:disabled {
  cursor: default;
}
.ct-die--support {
  border-style: dashed;
}
.ct-die--assigned {
  opacity: 0.45;
}
.ct-die--selected {
  outline: 2px solid #fbbf24;
  outline-offset: 2px;
}
.ct-die-face {
  font-size: 0.85rem;
  font-weight: 800;
  line-height: 1;
}
.ct-die-owner {
  font-size: 0.5rem;
  color: #cbd5e1;
  line-height: 1.1;
}
.ct-die-target {
  position: absolute;
  bottom: -0.8rem;
  font-size: 0.5rem;
  color: #94a3b8;
  white-space: nowrap;
}
.ct-hint {
  margin: 0.35rem 0 0;
  font-size: 0.7rem;
  color: #94a3b8;
}
</style>
