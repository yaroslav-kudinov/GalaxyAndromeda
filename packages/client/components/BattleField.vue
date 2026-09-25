<script setup lang="ts">
/**
 * Поле боя: флоты стоят друг напротив друга. Ваш флот внизу носом вверх, противник сверху.
 * Первая линия — корабли на клетке боя: они стреляют и служат целями. Вторая линия, позади, —
 * поддержка с соседних клеток: стреляет, но целью не служит.
 *
 * Кубики игрока лежат под его кораблями. Щелчок по вражескому кораблю отдаёт ему свободный
 * кубик (выбранный или самый точный), щелчок по кубику на цели — возвращает его. В раунде
 * выстрелы летят к целям, попавший корабль вспыхивает, уничтоженный взрывается.
 */
import type {
  CombatPreview,
  CombatRole,
  DiceTargets,
  PlayerCombatDie,
  ShipCombatRollLog,
  ShipType,
} from '@galaxy/rules'
import {
  autoDiceTargetsFor,
  combatSideOfPlayer,
  hitProbability,
  playerCombatDice,
  playerCombatTargets,
  SHIP_LABELS,
  shipHullInBattle,
} from '@galaxy/rules'
import { useUiStrings } from '~/i18n/ui-strings'

const props = withDefaults(
  defineProps<{
    preview: CombatPreview
    localPlayerId: string
    playerColors: Readonly<Record<string, string>>
    playerNames?: Readonly<Record<string, string>>
    /** Урон к началу раунда: в подготовке — из превью, между раундами — из боя. */
    damageByShipId?: Readonly<Record<string, number>>
    /** Игрок раздаёт свои кубики по целям щелчками. */
    editable?: boolean
    /** Показать кубики игрока и их цели, даже если менять уже нельзя. */
    showDice?: boolean
    roundNumber?: number
    /** Броски последнего раунда; показаны первые `revealed`. */
    rolls?: readonly ShipCombatRollLog[]
    revealed?: number
    /** Урон после раунда, накопленный с начала боя. */
    damageAfterRound?: Readonly<Record<string, number>>
    destroyedShipIds?: readonly string[]
    /** Пометка у имени стороны на средней линии — например, готовность в подготовке. */
    sideBadges?: Partial<Record<CombatRole, { text: string; on: boolean }>>
  }>(),
  {
    playerNames: () => ({}),
    damageByShipId: () => ({}),
    editable: false,
    showDice: false,
    roundNumber: 1,
    rolls: () => [],
    revealed: 0,
    damageAfterRound: () => ({}),
    destroyedShipIds: () => [],
    sideBadges: () => ({}),
  },
)

/** id стреляющего → цель каждого его кубика по порядку; пустая строка — цель выберет игра. */
const targetsModel = defineModel<DiceTargets>('targets', { default: () => ({}) })

const t = useUiStrings().battleField
const audio = useBattleAudio()

interface FieldShip {
  shipId: string
  type: ShipType
  ownerId: string
  side: CombatRole
  line: 'front' | 'back'
  hull: number
  dice: number
  threshold: number | null
  bonusDice: number
  distance: number
}

// ─── Состав боя ────────────────────────────────────────────────────────────

/**
 * Все корабли, какие видели в этом бою. Уничтоженные пропадают из превью, но их нужно
 * показать: взрыв и обломки — часть итога раунда.
 */
const known = ref(new Map<string, FieldShip>())

function remember(ship: FieldShip) {
  known.value.set(ship.shipId, ship)
}

watch(
  () => props.preview,
  (preview) => {
    const next = new Map(known.value)
    known.value = next
    for (const role of ['attacker', 'defender'] as const) {
      const side = preview[role]
      for (const ship of side.ships) {
        remember({
          shipId: ship.shipId,
          type: ship.type,
          ownerId: ship.ownerId,
          side: role,
          line: 'front',
          hull: ship.hull,
          dice: ship.dice,
          threshold: ship.threshold,
          bonusDice: ship.bonusDice,
          distance: 0,
        })
      }
      for (const ship of side.supportingShips) {
        remember({
          shipId: ship.shipId,
          type: ship.type,
          ownerId: ship.ownerId,
          side: role,
          line: 'back',
          hull: shipHullInBattle(ship.type),
          dice: ship.dice,
          threshold: ship.threshold,
          bonusDice: ship.bonusDice,
          distance: ship.distance,
        })
      }
    }
  },
  { immediate: true, deep: true },
)

watch(
  () => props.rolls,
  (rolls) => {
    for (const roll of rolls) {
      if (known.value.has(roll.shipId)) continue
      remember({
        shipId: roll.shipId,
        type: roll.shipType,
        ownerId: roll.ownerId,
        side: roll.side,
        line: roll.distance > 0 ? 'back' : 'front',
        hull: shipHullInBattle(roll.shipType),
        dice: roll.dice.length,
        threshold: roll.dice[0]?.threshold ?? null,
        bonusDice: 0,
        distance: roll.distance,
      })
    }
  },
  { immediate: true },
)

const inPreview = computed(() => {
  const ids = new Set<string>()
  for (const role of ['attacker', 'defender'] as const) {
    for (const ship of props.preview[role].ships) ids.add(ship.shipId)
    for (const ship of props.preview[role].supportingShips) ids.add(ship.shipId)
  }
  return ids
})

/** Обломки: уничтожены в этом бою — остаются на поле серыми силуэтами. */
const wrecks = ref(new Set<string>())

const localSide = computed((): CombatRole | null => combatSideOfPlayer(props.preview, props.localPlayerId))
/** Внизу — сторона игрока; кто не стреляет, смотрит со стороны атакующего (или своей, если защищается). */
const bottomSide = computed((): CombatRole => {
  if (localSide.value) return localSide.value
  return props.localPlayerId === props.preview.defenderId ? 'defender' : 'attacker'
})
const topSide = computed((): CombatRole => (bottomSide.value === 'attacker' ? 'defender' : 'attacker'))

/** Тяжёлые в центре внимания — первыми; порядок не зависит от того, как собрано превью. */
const CLASS_ORDER: Record<ShipType, number> = { hyper: 0, battleship: 1, carrier: 2, cruiser: 3, destroyer: 4 }

function shipsOf(side: CombatRole, line: 'front' | 'back'): FieldShip[] {
  return [...known.value.values()]
    .filter(
      (ship) =>
        ship.side === side
        && ship.line === line
        && (inPreview.value.has(ship.shipId) || wrecks.value.has(ship.shipId) || rollTouches.value.has(ship.shipId)),
    )
    .sort((a, b) => CLASS_ORDER[a.type] - CLASS_ORDER[b.type] || a.shipId.localeCompare(b.shipId))
}

const sideOwner = (side: CombatRole) => (side === 'attacker' ? props.preview.attackerId : props.preview.defenderId)
const colorOf = (playerId: string) => props.playerColors[playerId] ?? '#94a3b8'
const nameOf = (playerId: string) => props.playerNames[playerId] ?? playerId

// ─── Раунд: броски, попадания, взрывы ──────────────────────────────────────

/** Корабли, которых касается раунд: стрелявшие и цели. Уничтоженные в нём остаются на поле. */
const rollTouches = computed(() => {
  const ids = new Set<string>()
  for (const roll of props.rolls) {
    ids.add(roll.shipId)
    for (const die of roll.dice) if (die.targetShipId) ids.add(die.targetShipId)
  }
  return ids
})

function hitsOn(shipId: string, rolls: readonly ShipCombatRollLog[]): number {
  let hits = 0
  for (const roll of rolls) for (const die of roll.dice) if (die.hit && die.targetShipId === shipId) hits += 1
  return hits
}

const roundKey = computed(() =>
  props.rolls.map((roll) => `${roll.shipId}:${roll.dice.map((d) => `${d.value}>${d.targetShipId ?? '-'}`).join('.')}`).join('|'),
)

/** Попадания раунда, уже долетевшие до целей. */
const landed = ref(new Map<string, number>())
const processed = ref(0)
const struck = ref(new Set<string>())
const exploding = ref(new Set<string>())
const firing = ref(new Set<string>())

function damageBeforeRound(ship: FieldShip): number {
  const after = props.damageAfterRound[ship.shipId]
  if (after != null) return Math.max(0, after - hitsOn(ship.shipId, props.rolls))
  // Уничтоженного нет в уроне после раунда: до раунда у него было не больше «прочность − попадания».
  if (props.destroyedShipIds.includes(ship.shipId)) return Math.max(0, ship.hull - hitsOn(ship.shipId, props.rolls))
  return props.damageByShipId[ship.shipId] ?? 0
}

function shownDamage(ship: FieldShip): number {
  if (props.rolls.length) return damageBeforeRound(ship) + (landed.value.get(ship.shipId) ?? 0)
  const fromPreview = [...props.preview.attacker.ships, ...props.preview.defender.ships]
    .find((candidate) => candidate.shipId === ship.shipId)?.damage ?? 0
  return props.damageByShipId[ship.shipId] ?? fromPreview
}

function isDestroyed(ship: FieldShip): boolean {
  if (wrecks.value.has(ship.shipId)) return true
  return ship.line === 'front' && shownDamage(ship) >= ship.hull && props.rolls.length > 0
}

watch(roundKey, () => {
  landed.value = new Map()
  processed.value = 0
  struck.value = new Set()
  exploding.value = new Set()
})

// Выстрелы — слой поверх поля.
interface Bolt {
  id: number
  x1: number
  y1: number
  x2: number
  y2: number
  hit: boolean
  color: string
  length: number
}
interface Burst {
  id: number
  x: number
  y: number
  kind: 'hit' | 'boom'
  shards: { dx: number; dy: number; delay: number }[]
}
const bolts = ref<Bolt[]>([])
const bursts = ref<Burst[]>([])
let fxId = 0
const fieldRef = ref<HTMLElement | null>(null)
const shipEls = new Map<string, HTMLElement>()

function setShipEl(shipId: string, el: unknown) {
  if (el instanceof HTMLElement) shipEls.set(shipId, el)
  else shipEls.delete(shipId)
}

function centerOf(shipId: string): { x: number; y: number } | null {
  const el = shipEls.get(shipId)
  const field = fieldRef.value
  if (!el || !field) return null
  const box = el.getBoundingClientRect()
  const origin = field.getBoundingClientRect()
  return { x: box.left - origin.left + box.width / 2, y: box.top - origin.top + box.height / 2 }
}

function flash(set: typeof struck, shipId: string, ms: number) {
  set.value = new Set(set.value).add(shipId)
  setTimeout(() => {
    const next = new Set(set.value)
    next.delete(shipId)
    set.value = next
  }, ms)
}

function spawnBurst(x: number, y: number, kind: Burst['kind']) {
  const count = kind === 'boom' ? 14 : 6
  const reach = kind === 'boom' ? 46 : 20
  const burst: Burst = {
    id: ++fxId,
    x,
    y,
    kind,
    shards: Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2
      const distance = reach * (0.5 + Math.random() * 0.6)
      return { dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance, delay: Math.random() * 0.08 }
    }),
  }
  bursts.value = [...bursts.value, burst]
  setTimeout(() => {
    bursts.value = bursts.value.filter((entry) => entry.id !== burst.id)
  }, kind === 'boom' ? 1100 : 600)
}

function landHit(targetId: string) {
  const next = new Map(landed.value)
  next.set(targetId, (next.get(targetId) ?? 0) + 1)
  landed.value = next
  const target = known.value.get(targetId)
  if (!target) return
  const point = centerOf(targetId)
  if (target.line === 'front' && shownDamage(target) >= target.hull && !wrecks.value.has(targetId)) {
    flash(exploding, targetId, 700)
    wrecks.value = new Set(wrecks.value).add(targetId)
    if (point) spawnBurst(point.x, point.y, 'boom')
    audio.explosion()
  } else {
    flash(struck, targetId, 360)
    if (point) spawnBurst(point.x, point.y, 'hit')
    audio.hit()
  }
}

const reducedMotion = import.meta.client && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Разыграть броски одного корабля: вспышка орудий и выстрел на каждый кубик. */
function playRoll(roll: ShipCombatRollLog, animate: boolean) {
  if (!animate) {
    for (const die of roll.dice) if (die.hit && die.targetShipId) landHitQuiet(die.targetShipId)
    return
  }
  flash(firing, roll.shipId, 300)
  const from = centerOf(roll.shipId)
  roll.dice.forEach((die, index) => {
    const delay = index * 110
    setTimeout(() => {
      audio.shot(roll.shipType)
      const to = die.targetShipId ? centerOf(die.targetShipId) : null
      if (from && to) {
        // Промах уходит мимо: чуть в сторону от цели.
        const aim = die.hit ? to : { x: to.x + (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 12), y: to.y }
        const bolt: Bolt = {
          id: ++fxId,
          x1: from.x,
          y1: from.y,
          x2: aim.x,
          y2: aim.y,
          hit: die.hit,
          color: colorOf(roll.ownerId),
          length: Math.hypot(aim.x - from.x, aim.y - from.y),
        }
        bolts.value = [...bolts.value, bolt]
        setTimeout(() => {
          bolts.value = bolts.value.filter((entry) => entry.id !== bolt.id)
        }, 520)
      }
      setTimeout(() => {
        if (die.hit && die.targetShipId) landHit(die.targetShipId)
        else if (die.targetShipId) audio.miss()
      }, 230)
    }, delay)
  })
}

/** Без анимации (окно открыли на готовом итоге): урон и обломки сразу. */
function landHitQuiet(targetId: string) {
  const next = new Map(landed.value)
  next.set(targetId, (next.get(targetId) ?? 0) + 1)
  landed.value = next
  const target = known.value.get(targetId)
  if (target && target.line === 'front' && shownDamage(target) >= target.hull) {
    wrecks.value = new Set(wrecks.value).add(targetId)
  }
}

watch(
  () => [props.revealed, roundKey.value] as const,
  ([revealed]) => {
    const upTo = Math.min(revealed, props.rolls.length)
    // Скачок сразу на много бросков — окно открыли на готовом итоге: без анимации.
    const animate = !reducedMotion && upTo - processed.value <= 2
    if (animate && upTo > processed.value && processed.value === 0) audio.diceRoll()
    while (processed.value < upTo) {
      const roll = props.rolls[processed.value]
      processed.value += 1
      if (roll) nextTick(() => playRoll(roll, animate))
    }
  },
  { immediate: true },
)

// Обломки прошлых раундов: уничтоженные — из итога боя.
watch(
  () => [props.destroyedShipIds, props.revealed, props.rolls.length] as const,
  () => {
    if (props.revealed < props.rolls.length) return
    const next = new Set(wrecks.value)
    for (const id of props.destroyedShipIds) next.add(id)
    wrecks.value = next
  },
  { immediate: true },
)

/** Кубики раунда под стрелявшим: значение, попал ли, в кого. */
function rolledDice(shipId: string) {
  const index = props.rolls.findIndex((roll) => roll.shipId === shipId)
  if (index < 0 || index >= Math.min(props.revealed, props.rolls.length)) return []
  return props.rolls[index]!.dice
}

const sideHits = computed(() => {
  const totals = { attacker: 0, defender: 0 }
  for (const roll of props.rolls.slice(0, props.revealed)) totals[roll.side] += roll.hits
  return totals
})

// ─── Распределение кубиков ─────────────────────────────────────────────────

const myDice = computed((): PlayerCombatDie[] => playerCombatDice(props.preview, props.localPlayerId))
const myTargets = computed(() => playerCombatTargets(props.preview, props.localPlayerId, props.damageByShipId))
const targetIds = computed(() => new Set(myTargets.value.map((target) => target.shipId)))
const dicePanelVisible = computed(() => (props.editable || props.showDice) && myDice.value.length > 0)

const dieKey = (die: Pick<PlayerCombatDie, 'shooterShipId' | 'index'>) => `${die.shooterShipId}#${die.index}`

const assignment = computed(() => {
  const out = new Map<string, string | null>()
  for (const die of myDice.value) {
    const wanted = targetsModel.value[die.shooterShipId]?.[die.index] ?? ''
    out.set(dieKey(die), wanted && targetIds.value.has(wanted) ? wanted : null)
  }
  return out
})

const selectedDie = ref<string | null>(null)
const freeDice = computed(() => myDice.value.filter((die) => assignment.value.get(dieKey(die)) == null))

function writeAssignment(next: Map<string, string | null>) {
  const out: DiceTargets = {}
  for (const die of myDice.value) {
    const list = (out[die.shooterShipId] ??= [])
    list[die.index] = next.get(dieKey(die)) ?? ''
  }
  targetsModel.value = out
}

function diceOn(targetId: string): PlayerCombatDie[] {
  return myDice.value.filter((die) => assignment.value.get(dieKey(die)) === targetId)
}

function expectedOn(targetId: string): number {
  return diceOn(targetId).reduce((sum, die) => sum + hitProbability(die.threshold), 0)
}

function remainingHull(ship: FieldShip): number {
  return Math.max(0, ship.hull - shownDamage(ship))
}

function canTarget(ship: FieldShip): boolean {
  return props.editable && targetIds.value.has(ship.shipId) && !isDestroyed(ship)
}

/** Щелчок по вражескому кораблю: выбранный кубик, а если не выбран — самый точный из свободных. */
function assignTo(ship: FieldShip) {
  if (!canTarget(ship)) return
  const chosen = selectedDie.value ? freeDice.value.find((die) => dieKey(die) === selectedDie.value) : undefined
  const die = chosen ?? [...freeDice.value].sort((a, b) => a.threshold - b.threshold)[0]
  if (!die) return
  const next = new Map(assignment.value)
  next.set(dieKey(die), ship.shipId)
  selectedDie.value = null
  writeAssignment(next)
  audio.tick()
}

/** Снять кубик с цели: самый неточный — точные полезнее оставить. */
function unassignFrom(ship: FieldShip) {
  if (!props.editable) return
  const die = [...diceOn(ship.shipId)].sort((a, b) => b.threshold - a.threshold)[0]
  if (!die) return
  const next = new Map(assignment.value)
  next.set(dieKey(die), null)
  writeAssignment(next)
  audio.tick()
}

function onDieClick(die: PlayerCombatDie) {
  if (!props.editable) return
  const key = dieKey(die)
  if (assignment.value.get(key) != null) {
    const next = new Map(assignment.value)
    next.set(key, null)
    writeAssignment(next)
    audio.tick()
    return
  }
  selectedDie.value = selectedDie.value === key ? null : key
}

function diceOf(shooterId: string): PlayerCombatDie[] {
  return myDice.value.filter((die) => die.shooterShipId === shooterId)
}

interface DiceGroup {
  key: string
  threshold: number
  /** Цель группы; `null` — свободные кубики. */
  target: string | null
  dice: PlayerCombatDie[]
}

/**
 * Кубики корабля одной строкой: свободные — одной фишкой, назначенные — по фишке на цель.
 * По кубику на фишку выходит частокол: у линкора с авианосцем их четыре-пять.
 */
function ownDiceGroups(shooterId: string): DiceGroup[] {
  const groups = new Map<string, DiceGroup>()
  for (const die of diceOf(shooterId)) {
    const target = assignment.value.get(dieKey(die)) ?? null
    const key = `${die.threshold}|${target ?? ''}`
    const group = groups.get(key) ?? { key, threshold: die.threshold, target, dice: [] }
    group.dice.push(die)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => Number(a.target != null) - Number(b.target != null))
}

/** Кубики на цели, собранные по точности: «4+ ×2». */
function incomingGroups(targetId: string): DiceGroup[] {
  const groups = new Map<number, DiceGroup>()
  for (const die of diceOn(targetId)) {
    const group = groups.get(die.threshold) ?? { key: String(die.threshold), threshold: die.threshold, target: targetId, dice: [] }
    group.dice.push(die)
    groups.set(die.threshold, group)
  }
  return [...groups.values()].sort((a, b) => a.threshold - b.threshold)
}

function onGroupClick(group: DiceGroup) {
  if (!props.editable) return
  if (group.target != null) {
    // Назначенные: вернуть один кубик.
    const die = group.dice[group.dice.length - 1]
    if (die) onDieClick(die)
    return
  }
  // Свободные: выбрать кубик этого корабля — следующий щелчок по цели отдаст именно его.
  const selected = group.dice.find((die) => dieKey(die) === selectedDie.value)
  selectedDie.value = selected ? null : dieKey(group.dice[0]!)
}

function groupSelected(group: DiceGroup): boolean {
  return group.target == null && group.dice.some((die) => dieKey(die) === selectedDie.value)
}

function applyAuto() {
  if (!props.editable) return
  selectedDie.value = null
  targetsModel.value = autoDiceTargetsFor(props.preview, props.localPlayerId, props.damageByShipId)
  audio.tick()
}

function clearAll() {
  if (!props.editable) return
  selectedDie.value = null
  writeAssignment(new Map())
}

function targetShort(targetId: string | null | undefined): string {
  if (!targetId) return ''
  const target = known.value.get(targetId)
  return target ? SHIP_LABELS[target.type].slice(0, 3) : ''
}

function shipTitle(ship: FieldShip): string {
  return t.shipTitle(
    SHIP_LABELS[ship.type],
    nameOf(ship.ownerId),
    shownDamage(ship),
    ship.hull,
    ship.dice,
    ship.threshold,
    ship.line === 'back' ? ship.distance : 0,
  )
}

// ─── Фон боя ───────────────────────────────────────────────────────────────

let releaseAmbient: (() => void) | null = null
onMounted(() => {
  releaseAmbient = audio.holdAmbient()
})
onUnmounted(() => {
  releaseAmbient?.()
})

const lines = computed(() => [
  { key: 'top-back', side: topSide.value, line: 'back' as const },
  { key: 'top-front', side: topSide.value, line: 'front' as const },
  { key: 'bottom-front', side: bottomSide.value, line: 'front' as const },
  { key: 'bottom-back', side: bottomSide.value, line: 'back' as const },
])
</script>

<template>
  <div ref="fieldRef" class="bf" :class="{ 'bf--editable': editable }">
    <div class="bf-stars" aria-hidden="true" />

    <template v-for="row in lines" :key="row.key">
      <div
        v-if="row.key === 'bottom-front'"
        class="bf-midline"
        :style="{
          '--top-color': colorOf(sideOwner(topSide)),
          '--bottom-color': colorOf(sideOwner(bottomSide)),
        }"
      >
        <span class="bf-mid-side" :style="{ color: colorOf(sideOwner(topSide)) }">
          {{ nameOf(sideOwner(topSide)) }}<template v-if="rolls.length"> · {{ t.hits(sideHits[topSide]) }}</template>
          <span v-if="sideBadges[topSide]" class="bf-badge" :class="{ 'bf-badge--on': sideBadges[topSide]!.on }">{{ sideBadges[topSide]!.text }}</span>
        </span>
        <span class="bf-mid-round">{{ t.round(roundNumber) }}</span>
        <span class="bf-mid-side bf-mid-side--right" :style="{ color: colorOf(sideOwner(bottomSide)) }">
          <span v-if="sideBadges[bottomSide]" class="bf-badge" :class="{ 'bf-badge--on': sideBadges[bottomSide]!.on }">{{ sideBadges[bottomSide]!.text }}</span>
          {{ nameOf(sideOwner(bottomSide)) }}<template v-if="rolls.length"> · {{ t.hits(sideHits[bottomSide]) }}</template>
        </span>
      </div>

      <div
        v-if="shipsOf(row.side, row.line).length"
        class="bf-line"
        :class="[`bf-line--${row.line}`, row.side === topSide ? 'bf-line--top' : 'bf-line--bottom']"
      >
        <span v-if="row.line === 'back'" class="bf-line-tag">{{ preview.trigger === 'bombardment' && row.side === 'attacker' ? t.bombardLine : t.supportLine }}</span>
        <div
          v-for="ship in shipsOf(row.side, row.line)"
          :key="ship.shipId"
          class="bf-unit"
          :class="{
            'bf-unit--target': canTarget(ship),
            'bf-unit--wreck': isDestroyed(ship) && !exploding.has(ship.shipId),
            'bf-unit--mine': ship.ownerId === localPlayerId,
          }"
          :title="shipTitle(ship)"
          @click="assignTo(ship)"
          @contextmenu.prevent="unassignFrom(ship)"
        >
          <!-- Кубики раунда: к противнику -->
          <div v-if="rolledDice(ship.shipId).length" class="bf-rolled" :class="{ 'bf-rolled--below': row.side === topSide }">
            <span
              v-for="(die, di) in rolledDice(ship.shipId)"
              :key="di"
              class="bf-rolled-die"
              :class="die.hit ? 'bf-rolled-die--hit' : 'bf-rolled-die--miss'"
              :title="t.rolledTitle(die.value, die.threshold, die.hit, targetShort(die.targetShipId))"
            >{{ die.value }}</span>
          </div>

          <div :ref="(el) => setShipEl(ship.shipId, el)" class="bf-sprite">
            <BattleShipSprite
              :type="ship.type"
              :color="colorOf(ship.ownerId)"
              :hull="ship.hull"
              :damage="shownDamage(ship)"
              :facing="row.side === topSide ? 'down' : 'up'"
              :destroyed="isDestroyed(ship)"
              :struck="struck.has(ship.shipId)"
              :exploding="exploding.has(ship.shipId)"
              :firing="firing.has(ship.shipId)"
              :width="row.line === 'front' ? 46 : 34"
            />
          </div>

          <span class="bf-name">{{ SHIP_LABELS[ship.type] }}</span>
          <span class="bf-stats">
            <template v-if="isDestroyed(ship)">{{ t.destroyed }}</template>
            <template v-else-if="ship.dice && ship.threshold != null">{{ t.stats(ship.dice, ship.threshold) }}</template>
            <template v-else>{{ t.noFire }}</template>
          </span>

          <!-- Наши кубики на этой цели -->
          <div v-if="dicePanelVisible && targetIds.has(ship.shipId) && !isDestroyed(ship)" class="bf-incoming">
            <button
              v-for="group in incomingGroups(ship.shipId)"
              :key="group.key"
              type="button"
              class="bf-die bf-die--on-target"
              :style="{ '--die-color': colorOf(localPlayerId) }"
              :disabled="!editable"
              :title="t.returnDie(group.threshold)"
              @click.stop="onGroupClick(group)"
            >{{ t.dieGroup(group.threshold, group.dice.length) }}</button>
            <span
              v-if="diceOn(ship.shipId).length"
              class="bf-expected"
              :class="{ 'bf-expected--kill': expectedOn(ship.shipId) >= remainingHull(ship) }"
            >
              {{ expectedOn(ship.shipId) >= remainingHull(ship) ? t.likelyKill : t.expected(expectedOn(ship.shipId).toFixed(1)) }}
            </span>
          </div>

          <!-- Кубики этого нашего корабля -->
          <div v-if="dicePanelVisible && diceOf(ship.shipId).length" class="bf-own-dice">
            <button
              v-for="group in ownDiceGroups(ship.shipId)"
              :key="group.key"
              type="button"
              class="bf-die"
              :class="{
                'bf-die--assigned': group.target != null,
                'bf-die--free': group.target == null,
                'bf-die--selected': groupSelected(group),
              }"
              :style="{ '--die-color': colorOf(localPlayerId) }"
              :disabled="!editable"
              :title="t.dieTitle(group.threshold, targetShort(group.target))"
              @click.stop="onGroupClick(group)"
            >
              <span class="bf-die-face">{{ t.dieGroup(group.threshold, group.dice.length) }}</span>
              <span class="bf-die-target">{{ group.target ? t.dieTarget(targetShort(group.target)) : t.dieFree }}</span>
            </button>
          </div>
        </div>
      </div>
    </template>

    <div v-if="dicePanelVisible" class="bf-toolbar">
      <span class="bf-free" :class="{ 'bf-free--done': !freeDice.length }">
        {{ freeDice.length ? t.diceFree(freeDice.length, myDice.length) : t.allAssigned }}
      </span>
      <span v-if="editable" class="bf-hint">{{ t.hint }}</span>
      <span v-if="editable" class="bf-tools">
        <button type="button" class="bf-tool" :title="t.autoHint" @click="applyAuto">{{ t.auto }}</button>
        <button type="button" class="bf-tool" @click="clearAll">{{ t.clear }}</button>
      </span>
    </div>

    <svg class="bf-fx" aria-hidden="true">
      <line
        v-for="bolt in bolts"
        :key="bolt.id"
        class="bf-bolt"
        :class="{ 'bf-bolt--miss': !bolt.hit }"
        :x1="bolt.x1"
        :y1="bolt.y1"
        :x2="bolt.x2"
        :y2="bolt.y2"
        :stroke="bolt.color"
        :style="{ '--len': bolt.length }"
      />
    </svg>
    <div
      v-for="burst in bursts"
      :key="burst.id"
      class="bf-burst"
      :class="`bf-burst--${burst.kind}`"
      :style="{ left: `${burst.x}px`, top: `${burst.y}px` }"
      aria-hidden="true"
    >
      <span class="bf-burst-core" />
      <span
        v-for="(shard, si) in burst.shards"
        :key="si"
        class="bf-shard"
        :style="{ '--dx': `${shard.dx}px`, '--dy': `${shard.dy}px`, animationDelay: `${shard.delay}s` }"
      />
    </div>
  </div>
</template>

<style scoped>
.bf {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.6rem 0.5rem 0.5rem;
  border-radius: 10px;
  border: 1px solid rgba(71, 85, 105, 0.6);
  background:
    radial-gradient(ellipse 70% 40% at 50% 50%, rgba(30, 41, 59, 0.55), transparent 70%),
    linear-gradient(180deg, #020617 0%, #0b1224 50%, #020617 100%);
  overflow: hidden;
  user-select: none;
}
/* Поле живёт и в окне с ограниченной высотой: строки не сжимаются, а прокручиваются. */
.bf > * {
  flex-shrink: 0;
}
.bf-stars {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(1px 1px at 12% 18%, rgba(255, 255, 255, 0.55), transparent),
    radial-gradient(1px 1px at 72% 12%, rgba(255, 255, 255, 0.4), transparent),
    radial-gradient(1.5px 1.5px at 38% 64%, rgba(255, 255, 255, 0.35), transparent),
    radial-gradient(1px 1px at 86% 72%, rgba(255, 255, 255, 0.45), transparent),
    radial-gradient(1px 1px at 22% 86%, rgba(255, 255, 255, 0.3), transparent),
    radial-gradient(1px 1px at 58% 36%, rgba(255, 255, 255, 0.3), transparent);
  animation: bf-drift 40s linear infinite;
}
.bf-line {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.35rem 0.6rem;
  min-height: 3rem;
}
.bf-line--back {
  opacity: 0.92;
  padding-top: 0.9rem;
}
.bf-line--bottom.bf-line--back {
  padding-top: 0;
  padding-bottom: 0.2rem;
}
.bf-line-tag {
  position: absolute;
  top: 0;
  left: 0.3rem;
  font-size: 0.62rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #64748b;
}
.bf-line--bottom .bf-line-tag {
  top: auto;
  bottom: 0;
}
.bf-midline {
  position: relative;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.5rem;
  margin: 0.2rem 0;
  padding: 0.2rem 0.4rem;
  font-size: 0.72rem;
}
.bf-midline::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--top-color), rgba(148, 163, 184, 0.5), var(--bottom-color), transparent);
  opacity: 0.55;
}
.bf-mid-side {
  position: relative;
  font-weight: 600;
  text-shadow: 0 0 6px #020617;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bf-mid-side--right {
  text-align: right;
}
.bf-badge {
  margin: 0 0.3rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  border: 1px solid #475569;
  color: #94a3b8;
  font-size: 0.62rem;
  font-weight: 600;
}
.bf-badge--on {
  border-color: #16a34a;
  color: #86efac;
}
.bf-mid-round {
  position: relative;
  padding: 0.05rem 0.55rem;
  border-radius: 999px;
  border: 1px solid #334155;
  background: #0f172a;
  color: #cbd5e1;
  font-weight: 600;
}
.bf-unit {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  min-width: 3.9rem;
  padding: 0.2rem 0.25rem;
  border-radius: 8px;
  border: 1px solid transparent;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.bf-unit--target {
  cursor: crosshair;
}
.bf-unit--target:hover {
  border-color: rgba(248, 113, 113, 0.7);
  background: rgba(127, 29, 29, 0.18);
}
.bf-sprite {
  display: flex;
  justify-content: center;
}
.bf-name {
  font-size: 0.66rem;
  color: #cbd5e1;
}
.bf-stats {
  font-size: 0.62rem;
  color: #94a3b8;
}
.bf-unit--wreck .bf-name,
.bf-unit--wreck .bf-stats {
  color: #64748b;
}
.bf-rolled {
  display: flex;
  gap: 0.15rem;
  order: -1;
}
.bf-rolled--below {
  order: 5;
}
.bf-rolled-die {
  min-width: 1.05rem;
  padding: 0 0.15rem;
  border-radius: 4px;
  font-size: 0.66rem;
  font-weight: 700;
  text-align: center;
  animation: bf-die-pop 0.3s ease-out;
}
.bf-rolled-die--hit {
  background: #16a34a;
  color: #f0fdf4;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
}
.bf-rolled-die--miss {
  background: #334155;
  color: #94a3b8;
}
.bf-incoming,
.bf-own-dice {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.15rem;
  max-width: 5.5rem;
}
.bf-die {
  --die-color: #60a5fa;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  min-width: 1.45rem;
  padding: 0.05rem 0.15rem;
  border-radius: 5px;
  border: 1px solid var(--die-color);
  background: color-mix(in srgb, var(--die-color) 24%, #0f172a);
  color: #f8fafc;
  font-size: 0.62rem;
  font-weight: 700;
  line-height: 1.2;
  cursor: pointer;
}
.bf-die:disabled {
  cursor: default;
  opacity: 0.85;
}
.bf-die--assigned {
  opacity: 0.55;
}
.bf-die--free {
  border-style: dashed;
  box-shadow: 0 0 6px color-mix(in srgb, var(--die-color) 45%, transparent);
}
.bf-die--selected {
  outline: 2px solid #fde047;
  outline-offset: 1px;
}
.bf-die--on-target {
  background: var(--die-color);
  color: #020617;
}
.bf-die-target {
  font-size: 0.55rem;
  font-weight: 600;
  color: #cbd5e1;
}
.bf-expected {
  font-size: 0.6rem;
  color: #fcd34d;
}
.bf-expected--kill {
  color: #f87171;
  font-weight: 700;
}
.bf-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.6rem;
  padding: 0.35rem 0.4rem 0;
  border-top: 1px solid rgba(51, 65, 85, 0.7);
  font-size: 0.7rem;
  color: #94a3b8;
}
.bf-free {
  font-weight: 700;
  color: #fcd34d;
}
.bf-free--done {
  color: #86efac;
}
.bf-hint {
  flex: 1 1 12rem;
}
.bf-tools {
  display: inline-flex;
  gap: 0.3rem;
}
.bf-tool {
  padding: 0.15rem 0.5rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 0.7rem;
  cursor: pointer;
}
.bf-fx {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
}
.bf-bolt {
  stroke-width: 2.6;
  stroke-linecap: round;
  filter: drop-shadow(0 0 4px currentColor);
  stroke-dasharray: 22 calc(var(--len) * 1px);
  stroke-dashoffset: 22;
  animation: bf-bolt 0.26s linear forwards, bf-fade 0.5s ease-out forwards;
}
.bf-bolt--miss {
  stroke-width: 1.6;
  opacity: 0.7;
}
.bf-burst {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
}
.bf-burst-core {
  position: absolute;
  left: -12px;
  top: -12px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: radial-gradient(circle, #fef9c3 0%, #fb923c 45%, rgba(239, 68, 68, 0) 70%);
  animation: bf-core 0.45s ease-out forwards;
}
.bf-burst--boom .bf-burst-core {
  left: -26px;
  top: -26px;
  width: 52px;
  height: 52px;
  animation-duration: 0.8s;
}
.bf-shard {
  position: absolute;
  left: -2px;
  top: -2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #fdba74;
  box-shadow: 0 0 4px #fb923c;
  animation: bf-shard 0.55s ease-out forwards;
}
.bf-burst--boom .bf-shard {
  width: 5px;
  height: 5px;
  animation-duration: 0.95s;
}
@keyframes bf-drift {
  from { background-position: 0 0; }
  to { background-position: 0 240px; }
}
@keyframes bf-bolt {
  to { stroke-dashoffset: calc(var(--len) * -1px + 22px); }
}
@keyframes bf-fade {
  0%, 60% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes bf-core {
  0% { transform: scale(0.3); opacity: 1; }
  100% { transform: scale(1.6); opacity: 0; }
}
@keyframes bf-shard {
  0% { transform: translate(0, 0) scale(1); opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(0.3); opacity: 0; }
}
@keyframes bf-die-pop {
  0% { transform: scale(0.4) rotate(-40deg); opacity: 0; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}
@media (max-width: 520px) {
  .bf-unit {
    min-width: 3.3rem;
  }
  .bf-hint {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bf-stars,
  .bf-bolt,
  .bf-shard,
  .bf-burst-core,
  .bf-rolled-die {
    animation: none;
  }
}
</style>
