<script setup lang="ts">
import type { MapCellDefinition, PlayerState } from '@galaxy/rules'
import { PLAYER_COLORS, getCellResourceToken, hexKey } from '@galaxy/rules'
import {
  HEX_ORIENTATIONS,
  type HexOrientation,
  hexCenter,
  hexPoints,
  loadStoredAutoFit,
  loadStoredOrientation,
  storeAutoFit,
  storeOrientation,
} from '~/utils/hex-layout'
import { layoutShipPositions, shipBoardScale } from '~/utils/ship-glyphs'
import { effectiveGlyphScale, overlayContentScale } from '~/utils/board-glyphs'
import { STRATEGIC_ZOOM_THRESHOLD } from '~/utils/board-overview'
import { buildTerritoryOverlay } from '~/utils/hex-territory'
import type { TerritoryLabelPlayer } from '~/composables/usePlayerTerritoryLabels'

const props = withDefaults(
  defineProps<{
    cells: MapCellDefinition[]
    ghosts: { q: number; r: number }[]
    selectedKey: string | null
    symmetryOrbitKeys?: string[]
    actionMarkerKeys?: string[]
    productionMarkerKeys?: string[]
    availableActionMarkerKeys?: string[]
    availableProductionMarkerKeys?: string[]
    reachableKeys?: string[]
    destinationKeys?: string[]
    contestedKeys?: string[]
    supplyChainKeys?: string[]
    myTerritoryKeys?: string[]
    /** Слоты игроков (1–6), чьи территории не рисуем на карте */
    hideTerritoryPlayers?: number[]
    movementSourceKey?: string | null
    previewMoves?: {
      from: { q: number; r: number }
      to: { q: number; r: number }
      shipId?: string
      combat?: boolean
    }[]
    territoryLabelPlayers?: TerritoryLabelPlayer[]
    zoomable?: boolean
    orientation?: HexOrientation
    showOrientationToggle?: boolean
    showAutoFitToggle?: boolean
    autoFitOnMapChange?: boolean
    toolbarPlacement?: 'inline' | 'overlay'
    mode?: 'editor' | 'game'
    fillViewport?: boolean
    players?: PlayerState[]
    cellHoverTooltip?: boolean
  }>(),
  {
    zoomable: true,
    orientation: undefined,
    showOrientationToggle: true,
    showAutoFitToggle: true,
    autoFitOnMapChange: undefined,
    symmetryOrbitKeys: () => [],
    actionMarkerKeys: () => [],
    productionMarkerKeys: () => [],
    availableActionMarkerKeys: () => [],
    availableProductionMarkerKeys: () => [],
    reachableKeys: () => [],
    destinationKeys: () => [],
    contestedKeys: () => [],
    supplyChainKeys: () => [],
    myTerritoryKeys: () => [],
    hideTerritoryPlayers: () => [],
    movementSourceKey: null,
    previewMoves: () => [],
    territoryLabelPlayers: () => [],
    toolbarPlacement: 'overlay',
    mode: 'editor',
    fillViewport: true,
    players: () => [],
    cellHoverTooltip: undefined,
  },
)

const HOVER_TOOLTIP_DELAY_MS = 1000
const showCellHoverTooltip = computed(
  () => props.cellHoverTooltip ?? props.mode === 'game',
)
const hoverTooltipCell = ref<MapCellDefinition | null>(null)
const hoverTooltipVisible = ref(false)
const hoverTooltipPos = ref({ x: 0, y: 0 })
let hoverTooltipTimer: ReturnType<typeof setTimeout> | null = null

function clearHoverTooltipTimer() {
  if (hoverTooltipTimer) {
    clearTimeout(hoverTooltipTimer)
    hoverTooltipTimer = null
  }
}

function clampTooltipPos(x: number, y: number) {
  const offset = 14
  const maxW = 280
  const maxH = 220
  return {
    x: Math.max(8, Math.min(x + offset, window.innerWidth - maxW - 8)),
    y: Math.max(8, Math.min(y + offset, window.innerHeight - maxH - 8)),
  }
}

function onCellMouseEnter(cell: MapCellDefinition, e: MouseEvent) {
  if (!showCellHoverTooltip.value) return
  clearHoverTooltipTimer()
  hoverTooltipVisible.value = false
  hoverTooltipCell.value = cell
  const { clientX, clientY } = e
  hoverTooltipTimer = setTimeout(() => {
    hoverTooltipPos.value = clampTooltipPos(clientX, clientY)
    hoverTooltipVisible.value = true
  }, HOVER_TOOLTIP_DELAY_MS)
}

function onCellMouseLeave() {
  clearHoverTooltipTimer()
  hoverTooltipCell.value = null
  hoverTooltipVisible.value = false
}

function onCellMouseMove(_cell: MapCellDefinition, e: MouseEvent) {
  if (!hoverTooltipVisible.value) return
  hoverTooltipPos.value = clampTooltipPos(e.clientX, e.clientY)
}

onUnmounted(clearHoverTooltipTimer)

const emit = defineEmits<{
  select: [q: number, r: number]
  addGhost: [q: number, r: number]
  'update:orientation': [orientation: HexOrientation]
  'update:autoFitOnMapChange': [enabled: boolean]
}>()

const size = 36
const svgRef = ref<SVGSVGElement | null>(null)
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0, panX: 0, panY: 0 })

const internalOrientation = ref<HexOrientation>('flat')
const orientation = computed({
  get: () => props.orientation ?? internalOrientation.value,
  set: (value: HexOrientation) => {
    internalOrientation.value = value
    storeOrientation(value)
    emit('update:orientation', value)
  },
})

const internalAutoFit = ref(true)
const autoFitOnMapChange = computed({
  get: () => props.autoFitOnMapChange ?? internalAutoFit.value,
  set: (value: boolean) => {
    internalAutoFit.value = value
    storeAutoFit(value)
    emit('update:autoFitOnMapChange', value)
  },
})

onMounted(() => {
  if (props.orientation == null) {
    internalOrientation.value = loadStoredOrientation()
  }
  if (props.autoFitOnMapChange == null) {
    internalAutoFit.value = loadStoredAutoFit()
  }
})

function center(q: number, r: number) {
  return hexCenter(q, r, size, orientation.value)
}

function points(q: number, r: number) {
  return hexPoints(q, r, size, orientation.value)
}

const NEUTRAL_CELL_FILL = '#6a7483'

const territoryOverlay = computed(() =>
  buildTerritoryOverlay(
    props.cells,
    size,
    orientation.value,
    0.32,
    props.hideTerritoryPlayers,
  ),
)

function cellOutlineClass(cell: MapCellDefinition): Record<string, boolean> {
  const key = hexKey(cell.q, cell.r)
  return {
    hex: true,
    'hex-outline': true,
    selected: props.selectedKey === key,
    'movement-source': isMovementSource(key),
    reachable: isReachable(key) && !isContested(key),
    contested: isContested(key),
    'supply-chain': isSupplyChain(key),
    destination: isDestination(key),
    symmetric: isSymmetricMate(key),
  }
}

function hasCellOutline(cell: MapCellDefinition): boolean {
  const c = cellOutlineClass(cell)
  return !!(
    c.selected ||
    c['movement-source'] ||
    c.reachable ||
    c.contested ||
    c['supply-chain'] ||
    c.destination ||
    c.symmetric
  )
}

function shipPositions(cell: MapCellDefinition): { x: number; y: number }[] {
  const c = center(cell.q, cell.r)
  const offsets = layoutShipPositions(cell.startingShips ?? [])
  return offsets.map((o) => ({ x: c.x + o.x, y: c.y + o.y }))
}

function cellShipScale(cell: MapCellDefinition): number {
  return effectiveGlyphScale(shipBoardScale(cell.startingShips ?? []), zoom.value, props.mode)
}

const overlayScale = computed(() => overlayContentScale(zoom.value))

const isZoomedOut = computed(() => zoom.value <= STRATEGIC_ZOOM_THRESHOLD)

function isSymmetricMate(key: string): boolean {
  if (!props.symmetryOrbitKeys.length) return false
  if (key === props.selectedKey) return false
  return props.symmetryOrbitKeys.includes(key)
}

function insetHexPoints(q: number, r: number, factor: number): string {
  const c = center(q, r)
  return points(q, r)
    .split(' ')
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number)
      return `${c.x + (x - c.x) * factor},${c.y + (y - c.y) * factor}`
    })
    .join(' ')
}

function hasActionMarker(key: string): boolean {
  return props.actionMarkerKeys.includes(key)
}

function hasProductionMarker(key: string): boolean {
  return props.productionMarkerKeys.includes(key)
}

function isAvailableActionMarker(key: string): boolean {
  return props.availableActionMarkerKeys.includes(key)
}

function isAvailableProductionMarker(key: string): boolean {
  return props.availableProductionMarkerKeys.includes(key)
}

function isReachable(key: string): boolean {
  return props.reachableKeys.includes(key)
}

function isDestination(key: string): boolean {
  return props.destinationKeys.includes(key)
}

function isContested(key: string): boolean {
  return props.contestedKeys.includes(key)
}

function isSupplyChain(key: string): boolean {
  return props.supplyChainKeys.includes(key)
}

function isMovementSource(key: string): boolean {
  return props.movementSourceKey != null && props.movementSourceKey === key
}

function shipAnchorAt(q: number, r: number, shipId?: string): { x: number; y: number } {
  const cell = props.cells.find((c) => c.q === q && c.r === r)
  if (!cell?.startingShips?.length) return center(q, r)

  const positions = shipPositions(cell)
  if (shipId) {
    const idx = cell.startingShips.findIndex(
      (s) => (s as { id?: string }).id === shipId,
    )
    if (idx >= 0 && positions[idx]) return positions[idx]
  }

  return positions.length === 1 ? positions[0] : center(q, r)
}

const previewArrowPaths = computed(() =>
  props.previewMoves.map((move, idx) => {
    const from = shipAnchorAt(move.from.q, move.from.r, move.shipId)
    const to = center(move.to.q, move.to.r)
    return {
      key: `preview-${idx}-${hexKey(move.from.q, move.from.r)}-${hexKey(move.to.q, move.to.r)}-${move.shipId ?? idx}`,
      d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
      combat: !!move.combat,
    }
  }),
)

const contentBounds = computed(() => {
  const all = [...props.cells, ...props.ghosts]
  if (!all.length) return { minX: 0, minY: 0, width: 100, height: 100 }
  const xs = all.map((c) => center(c.q, c.r).x)
  const ys = all.map((c) => center(c.q, c.r).y)
  // Поле включает наружные подписи игроков (дистанция до 3.5 радиусов + ширина label).
  const pad = size * 6.25
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  const maxX = Math.max(...xs) + pad
  const maxY = Math.max(...ys) + pad
  return { minX, minY, width: maxX - minX, height: maxY - minY }
})

/** Fixed viewport radius in SVG units when auto-fit is off (does not grow with the map) */
const FIXED_VIEW_RADIUS = size * 6

const displayViewBox = computed(() => {
  const b = contentBounds.value
  let cx: number
  let cy: number
  let w: number
  let h: number

  if (autoFitOnMapChange.value) {
    cx = b.minX + b.width / 2 + pan.value.x
    cy = b.minY + b.height / 2 + pan.value.y
    w = b.width / zoom.value
    h = b.height / zoom.value
  } else {
    const origin = hexCenter(0, 0, size, orientation.value)
    cx = origin.x + pan.value.x
    cy = origin.y + pan.value.y
    w = (FIXED_VIEW_RADIUS * 2) / zoom.value
    h = (FIXED_VIEW_RADIUS * 2) / zoom.value
  }

  return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`
})

function resetView() {
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
}

/** Stable hex layout — ignores ship/marker updates during polling */
const cellLayoutKey = computed(() =>
  props.cells
    .map((c) => `${c.q},${c.r}`)
    .sort()
    .join('|'),
)

const lastFittedLayoutKey = ref<string | null>(null)

watch(cellLayoutKey, (key) => {
  if (!key || !autoFitOnMapChange.value) return

  if (props.mode === 'game') {
    if (lastFittedLayoutKey.value === key) return
    lastFittedLayoutKey.value = key
    resetView()
    return
  }

  resetView()
})

watch(
  () => [props.cells.length, props.ghosts.length, orientation.value] as const,
  (_curr, prev) => {
    if (prev === undefined || props.mode === 'game') return
    if (autoFitOnMapChange.value) resetView()
  },
)

function clampZoom(value: number) {
  return Math.min(3, Math.max(0.35, value))
}

function zoomBy(factor: number) {
  zoom.value = clampZoom(zoom.value * factor)
}

function onWheel(e: WheelEvent) {
  if (!props.zoomable) return
  e.preventDefault()
  zoomBy(e.deltaY > 0 ? 0.9 : 1.1)
}

function onPointerDown(e: PointerEvent) {
  if (!props.zoomable || e.button !== 2) return
  e.preventDefault()
  dragging.value = true
  dragStart.value = { x: e.clientX, y: e.clientY, panX: pan.value.x, panY: pan.value.y }
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value || !svgRef.value) return
  const rect = svgRef.value.getBoundingClientRect()
  const viewParts = displayViewBox.value.split(' ').map(Number)
  const viewW = viewParts[2] ?? 100
  const viewH = viewParts[3] ?? 100
  const scaleX = viewW / rect.width
  const scaleY = viewH / rect.height
  pan.value = {
    x: dragStart.value.panX - (e.clientX - dragStart.value.x) * scaleX,
    y: dragStart.value.panY - (e.clientY - dragStart.value.y) * scaleY,
  }
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
}
</script>

<template>
  <div class="hex-board-wrap" :class="{ 'fill-viewport': fillViewport, overlay: toolbarPlacement === 'overlay' }">
    <div
      v-if="zoomable"
      class="zoom-bar"
      :class="{ 'zoom-bar--overlay': toolbarPlacement === 'overlay' }"
    >
      <div class="tool-row">
        <button type="button" class="tool-icon" title="Приблизить" @click="zoomBy(1.2)">+</button>
        <span class="zoom-label">{{ Math.round(zoom * 100) }}%</span>
        <button type="button" class="tool-icon" title="Отдалить" @click="zoomBy(1 / 1.2)">−</button>
        <button type="button" class="tool-icon" title="Сбросить вид" @click="resetView">↺</button>
      </div>
      <div v-if="showOrientationToggle || showAutoFitToggle" class="tool-row">
        <div v-if="showOrientationToggle" class="orient-group">
          <button
            v-for="opt in HEX_ORIENTATIONS"
            :key="opt.id"
            type="button"
            class="tool-label"
            :class="{ active: orientation === opt.id }"
            :title="opt.title"
            @click="orientation = opt.id"
          >
            {{ opt.label }}
          </button>
        </div>
        <button
          v-if="showAutoFitToggle"
          type="button"
          class="tool-label autofit-btn"
          :class="{ active: autoFitOnMapChange }"
          title="Авто-обзор при изменении карты"
          @click="autoFitOnMapChange = !autoFitOnMapChange"
        >
          Авто
        </button>
      </div>
    </div>

    <svg
      ref="svgRef"
      :viewBox="displayViewBox"
      class="hex-board"
      :class="{
        panning: dragging,
        'hex-board--fill': fillViewport,
        'hex-board--zoomed-out': isZoomedOut,
      }"
      xmlns="http://www.w3.org/2000/svg"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @contextmenu.prevent
    >
      <defs>
        <marker
          id="move-arrow-normal"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="rgba(56, 189, 248, 0.95)" />
        </marker>
        <marker
          id="move-arrow-combat"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="rgba(248, 113, 113, 0.95)" />
        </marker>
        <linearGradient
          v-for="band in territoryOverlay.bands"
          :id="band.gradientId"
          :key="band.gradientId"
          gradientUnits="userSpaceOnUse"
          :x1="band.gx1"
          :y1="band.gy1"
          :x2="band.gx2"
          :y2="band.gy2"
        >
          <stop offset="0%" :stop-color="PLAYER_COLORS[band.player] ?? '#888'" stop-opacity="0.88" />
          <stop offset="42%" :stop-color="PLAYER_COLORS[band.player] ?? '#888'" stop-opacity="0.36" />
          <stop offset="100%" :stop-color="NEUTRAL_CELL_FILL" stop-opacity="0" />
        </linearGradient>
        <linearGradient
          v-for="corner in territoryOverlay.corners"
          :id="corner.gradientId"
          :key="corner.gradientId"
          gradientUnits="userSpaceOnUse"
          :x1="corner.gx1"
          :y1="corner.gy1"
          :x2="corner.gx2"
          :y2="corner.gy2"
        >
          <stop offset="0%" :stop-color="PLAYER_COLORS[corner.player] ?? '#888'" stop-opacity="0.88" />
          <stop offset="42%" :stop-color="PLAYER_COLORS[corner.player] ?? '#888'" stop-opacity="0.36" />
          <stop offset="100%" :stop-color="NEUTRAL_CELL_FILL" stop-opacity="0" />
        </linearGradient>
      </defs>

      <!-- SVG paint order (bottom → top): fills → territory → content → outlines -->
      <PlayerTerritoryLabels
        :cells="cells"
        :players="territoryLabelPlayers"
        :hex-size="size"
        :orientation="orientation"
      />

      <g v-for="g in ghosts" :key="'g' + hexKey(g.q, g.r)">
        <polygon :points="points(g.q, g.r)" class="ghost" @click="emit('addGhost', g.q, g.r)" />
        <text :x="center(g.q, g.r).x" :y="center(g.q, g.r).y" class="ghost-label">+</text>
      </g>

      <g v-for="cell in cells" :key="hexKey(cell.q, cell.r)">
        <polygon
          :points="points(cell.q, cell.r)"
          :class="{ hex: true, owned: cell.startPlayer != null }"
          :fill="NEUTRAL_CELL_FILL"
          @click="emit('select', cell.q, cell.r)"
          @mouseenter="onCellMouseEnter(cell, $event)"
          @mouseleave="onCellMouseLeave"
          @mousemove="onCellMouseMove(cell, $event)"
        />
        <polygon
          v-if="isReachable(hexKey(cell.q, cell.r))"
          :points="points(cell.q, cell.r)"
          class="hex-overlay hex-overlay--reachable"
          pointer-events="none"
        />
        <polygon
          v-if="isContested(hexKey(cell.q, cell.r))"
          :points="points(cell.q, cell.r)"
          class="hex-overlay hex-overlay--contested"
          pointer-events="none"
        />
        <polygon
          v-if="isDestination(hexKey(cell.q, cell.r))"
          :points="points(cell.q, cell.r)"
          class="hex-overlay hex-overlay--destination"
          pointer-events="none"
        />
      </g>

      <!-- Contiguous control: soft edge bands, concave corner wedges, perimeter path -->
      <g class="territory-edges" pointer-events="none" aria-hidden="true">
        <polygon
          v-for="band in territoryOverlay.bands"
          :key="band.key + '-fill'"
          :points="band.points"
          :fill="`url(#${band.gradientId})`"
        />
        <polygon
          v-for="corner in territoryOverlay.corners"
          :key="corner.key"
          :points="corner.points"
          :fill="`url(#${corner.gradientId})`"
        />
        <path
          v-for="perimeter in territoryOverlay.paths"
          :key="perimeter.key"
          :d="perimeter.d"
          class="territory-perimeter"
          :stroke="PLAYER_COLORS[perimeter.player] ?? '#888'"
        />
      </g>

      <g v-for="cell in cells" :key="'decor-' + hexKey(cell.q, cell.r)">
        <polygon
          v-if="hasProductionMarker(hexKey(cell.q, cell.r))"
          :points="insetHexPoints(cell.q, cell.r, 0.93)"
          class="hex-marker-ring hex-marker-ring--underlay"
          pointer-events="none"
        />
        <polygon
          v-if="hasProductionMarker(hexKey(cell.q, cell.r))"
          :points="insetHexPoints(cell.q, cell.r, 0.93)"
          class="hex-marker-ring hex-marker-ring--production"
          :class="{ 'hex-marker-ring--available': isAvailableProductionMarker(hexKey(cell.q, cell.r)) }"
          pointer-events="none"
        />
        <polygon
          v-if="hasActionMarker(hexKey(cell.q, cell.r))"
          :points="insetHexPoints(cell.q, cell.r, 0.78)"
          class="hex-marker-ring hex-marker-ring--underlay"
          pointer-events="none"
        />
        <polygon
          v-if="hasActionMarker(hexKey(cell.q, cell.r))"
          :points="insetHexPoints(cell.q, cell.r, 0.78)"
          class="hex-marker-ring hex-marker-ring--action"
          :class="{ 'hex-marker-ring--available': isAvailableActionMarker(hexKey(cell.q, cell.r)) }"
          pointer-events="none"
        />

        <HexCellOverview
          :cell="cell"
          :cx="center(cell.q, cell.r).x"
          :cy="center(cell.q, cell.r).y"
          :hex-size="size"
          :content-scale="overlayScale"
          :show-resource="!!getCellResourceToken(cell)"
          :show-power-center="!!cell.isPowerCenter"
          :show-action-marker="hasActionMarker(hexKey(cell.q, cell.r))"
          :show-production-marker="hasProductionMarker(hexKey(cell.q, cell.r))"
          :action-marker-available="isAvailableActionMarker(hexKey(cell.q, cell.r))"
          :production-marker-available="isAvailableProductionMarker(hexKey(cell.q, cell.r))"
        />
      </g>

      <g class="hex-ships-layer" aria-hidden="true">
        <g v-for="cell in cells" :key="'ships-' + hexKey(cell.q, cell.r)">
          <g v-if="cell.startingShips?.length">
            <g
              v-for="(ship, idx) in cell.startingShips"
              :key="idx"
              :transform="`translate(${shipPositions(cell)[idx].x}, ${shipPositions(cell)[idx].y})`"
            >
              <ShipGlyph
                :type="ship.type"
                :player-color="PLAYER_COLORS[ship.player] ?? '#888'"
                :scale="cellShipScale(cell)"
              />
            </g>
          </g>
        </g>
      </g>

      <g v-for="arrow in previewArrowPaths" :key="arrow.key" pointer-events="none">
        <path
          :d="arrow.d"
          class="move-preview-line"
          :class="{ 'move-preview-line--combat': arrow.combat }"
          :marker-end="arrow.combat ? 'url(#move-arrow-combat)' : 'url(#move-arrow-normal)'"
        />
      </g>

      <!-- Selection / combat / retreat outlines above territory, ships, markers -->
      <g class="hex-outlines-layer" pointer-events="none" aria-hidden="true">
        <template v-for="cell in cells" :key="'outline-' + hexKey(cell.q, cell.r)">
          <polygon
            v-if="hasCellOutline(cell)"
            :points="points(cell.q, cell.r)"
            :class="cellOutlineClass(cell)"
            fill="none"
          />
        </template>
      </g>
    </svg>

    <Teleport to="body">
      <HexCellTooltip
        v-if="showCellHoverTooltip && hoverTooltipVisible && hoverTooltipCell"
        :cell="hoverTooltipCell"
        :players="players"
        :x="hoverTooltipPos.x"
        :y="hoverTooltipPos.y"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.hex-board-wrap {
  position: relative;
  width: 100%;
}
.hex-board-wrap.fill-viewport {
  position: absolute;
  inset: 0;
  max-width: none;
  overflow: hidden;
}
.hex-board-wrap.overlay .zoom-bar--overlay {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 12;
  margin: 0;
  padding: 0.3rem;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(71, 85, 105, 0.75);
  backdrop-filter: blur(6px);
  flex-direction: column;
  align-items: stretch;
  gap: 0.25rem;
  max-width: none;
}
.zoom-bar {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.tool-row {
  display: flex;
  align-items: center;
  gap: 0.2rem;
}
.zoom-bar button.tool-icon {
  width: 1.65rem;
  height: 1.65rem;
  padding: 0;
  border-radius: 5px;
  border: 1px solid #475569;
  background: #334155;
  color: #f8fafc;
  cursor: pointer;
  font-size: 0.95rem;
  line-height: 1;
  flex-shrink: 0;
}
.zoom-bar button.tool-label {
  height: 1.65rem;
  min-width: 2.4rem;
  padding: 0 0.35rem;
  border-radius: 5px;
  border: 1px solid #475569;
  background: #334155;
  color: #e2e8f0;
  cursor: pointer;
  font-size: 0.68rem;
  line-height: 1.65rem;
  white-space: nowrap;
  box-sizing: border-box;
}
.orient-group {
  display: flex;
  gap: 0.2rem;
}
.tool-label.active {
  border-color: #fbbf24;
  background: #1e3a5f;
  color: #f8fafc;
}
.autofit-btn:not(.active) {
  border-color: #64748b;
  background: #1e293b;
  color: #94a3b8;
}
.zoom-label {
  min-width: 2.5rem;
  text-align: center;
  font-size: 0.72rem;
  color: #cbd5e1;
  flex: 1;
}
.hex-board {
  width: 100%;
  height: 420px;
  background: #0f172a;
  border-radius: 8px;
  touch-action: none;
  user-select: none;
  display: block;
}
.hex-board--fill {
  height: 100%;
  min-height: 0;
  border-radius: 0;
}
.hex-board-wrap.fill-viewport .hex-board--fill {
  height: 100%;
}
.hex-board.panning {
  cursor: grabbing;
}
.hex {
  stroke: #334155;
  stroke-width: 1.4;
  cursor: pointer;
  opacity: 0.95;
}
.hex.owned {
  stroke: rgba(15, 23, 42, 0.4);
}
.territory-perimeter {
  fill: none;
  stroke-width: 2.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.98;
}
.territory-edges {
  pointer-events: none;
}
.hex-outlines-layer .hex-outline {
  fill: none;
}
.hex.selected {
  stroke: #fbbf24;
  stroke-width: 3;
}
.hex.movement-source {
  stroke: #fef08a;
  stroke-width: 3;
  filter: drop-shadow(0 0 4px rgba(250, 204, 21, 0.55));
}
.hex-overlay {
  stroke: none;
  pointer-events: none;
}
.hex-overlay--reachable {
  fill: rgba(74, 222, 128, 0.22);
}
.hex-overlay--destination {
  fill: rgba(56, 189, 248, 0.28);
}
.hex-overlay--contested {
  fill: rgba(248, 113, 113, 0.32);
}
.hex.reachable {
  stroke: rgba(74, 222, 128, 0.85);
  stroke-width: 2;
}
.hex.contested {
  stroke: rgba(248, 113, 113, 0.95);
  stroke-width: 2.5;
}
.hex.supply-chain {
  stroke: rgba(52, 211, 153, 0.75);
  stroke-width: 2;
}
.hex.destination {
  stroke: rgba(56, 189, 248, 0.95);
  stroke-width: 2.5;
}
.move-preview-line {
  fill: none;
  stroke: rgba(56, 189, 248, 0.85);
  stroke-width: 2.5;
  stroke-dasharray: 6 4;
  opacity: 0.9;
}
.move-preview-line--combat {
  stroke: rgba(248, 113, 113, 0.9);
}
.hex-marker-ring {
  fill: none;
  pointer-events: none;
  vector-effect: non-scaling-stroke;
}
.hex-marker-ring--underlay {
  stroke: #0f172a;
  stroke-width: 5;
}
.hex-marker-ring--action {
  stroke: #fef08a;
  stroke-width: 2.2;
}
.hex-marker-ring--production {
  stroke: #f472b6;
  stroke-width: 2.2;
}
.hex-marker-ring--action.hex-marker-ring--available,
.hex-marker-ring--production.hex-marker-ring--available {
  animation: marker-ring-available 1.55s ease-in-out infinite;
}
.hex-marker-ring--action.hex-marker-ring--available {
  filter: drop-shadow(0 0 5px rgba(254, 240, 138, 0.65));
}
.hex-marker-ring--production.hex-marker-ring--available {
  filter: drop-shadow(0 0 5px rgba(244, 114, 182, 0.65));
}
@keyframes marker-ring-available {
  0%,
  100% {
    stroke-opacity: 0.55;
    stroke-width: 2.2;
  }
  50% {
    stroke-opacity: 1;
    stroke-width: 2.8;
  }
}
.hex-board--zoomed-out .hex-marker-ring--action,
.hex-board--zoomed-out .hex-marker-ring--production {
  stroke-width: 3.2;
}
.hex-board--zoomed-out .hex-marker-ring--underlay {
  stroke-width: 6.5;
}
.hex.symmetric {
  stroke: #38bdf8;
  stroke-width: 2;
  stroke-dasharray: 4 2;
}
.ghost {
  fill: transparent;
  stroke: #475569;
  stroke-dasharray: 4 2;
  cursor: pointer;
}
.ghost-label {
  fill: #94a3b8;
  font-size: 14px;
  text-anchor: middle;
  dominant-baseline: middle;
  pointer-events: none;
}
.hex-ships-layer {
  pointer-events: none;
}
</style>
