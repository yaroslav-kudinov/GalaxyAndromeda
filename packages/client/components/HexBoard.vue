<script setup lang="ts">
import type { GameSnapshot, MapCellDefinition, PlayerState, RegionInfo, ShipType } from '@galaxy/rules'
import { PLAYER_COLORS, findRegionAtCell, gameStateFromSnapshot, getCellResourceToken, getRegionInfo, hexKey } from '@galaxy/rules'
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
import { useShipMoveTweens } from '~/composables/useShipMoveTweens'

const props = withDefaults(
  defineProps<{
    cells: MapCellDefinition[]
    ghosts: { q: number; r: number }[]
    selectedKey: string | null
    /** Доп. выделение (редактор, Ctrl+клик) */
    selectedKeys?: string[]
    symmetryOrbitKeys?: string[]
    actionMarkerKeys?: string[]
    availableActionMarkerKeys?: string[]
    /** Доп. клетки, с которыми можно взаимодействовать (поверх reachable / маркеров). */
    interactiveKeys?: string[]
    reachableKeys?: string[]
    destinationKeys?: string[]
    contestedKeys?: string[]
    supplyChainKeys?: string[]
    /** Клетки, чью фишку ресурса сейчас можно выбрать для оплаты постройки */
    tokenPickKeys?: string[]
    /** Клетки, чья фишка уже выбрана для оплаты */
    tokenPickedKeys?: string[]
    /** Центры власти, которые перейдут к другому игроку в начале следующего хода: цвет захватчика и пояснение */
    captureAhead?: Record<string, { color: string; note: string }>
    /** Осаждённые клетки: цвет осаждающего и пояснение для подсказки. */
    siegeMarks?: Record<string, { color: string; note: string }>
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
    previewPlacements?: {
      q: number
      r: number
      type: ShipType
      player: number
    }[]
    previewPlacementsPulse?: boolean
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
    /** Полупрозрачная заливка гексов — космос за картой просвечивает (игровая комната). */
    translucentCells?: boolean
    combatPulseKeys?: string[]
    /** Целевая клетка текущего шага обучения. */
    tutorialHighlightKeys?: string[]
    incomingShipIds?: string[]
    /** Корабли, для которых сейчас выбирают клетку назначения (пульс глифа). */
    activeShipIds?: string[]
    combatGhosts?: {
      id: string
      type: ShipType
      player: number
      q: number
      r: number
    }[]
    observationRevision?: number
    snapshot?: GameSnapshot | null
    mapId?: string | null
  }>(),
  {
    zoomable: true,
    orientation: undefined,
    showOrientationToggle: true,
    showAutoFitToggle: true,
    autoFitOnMapChange: undefined,
    selectedKeys: () => [],
    symmetryOrbitKeys: () => [],
    actionMarkerKeys: () => [],
    availableActionMarkerKeys: () => [],
    interactiveKeys: () => [],
    reachableKeys: () => [],
    destinationKeys: () => [],
    contestedKeys: () => [],
    supplyChainKeys: () => [],
    tokenPickKeys: () => [],
    tokenPickedKeys: () => [],
    captureAhead: () => ({}),
    siegeMarks: () => ({}),
    myTerritoryKeys: () => [],
    hideTerritoryPlayers: () => [],
    movementSourceKey: null,
    previewMoves: () => [],
    previewPlacements: () => [],
    previewPlacementsPulse: false,
    territoryLabelPlayers: () => [],
    toolbarPlacement: 'overlay',
    mode: 'editor',
    fillViewport: true,
    players: () => [],
    cellHoverTooltip: undefined,
    translucentCells: false,
    combatPulseKeys: () => [],
    tutorialHighlightKeys: () => [],
    incomingShipIds: () => [],
    activeShipIds: () => [],
    combatGhosts: () => [],
    observationRevision: 0,
    snapshot: null,
    mapId: null,
  },
)

const HOVER_TOOLTIP_DELAY_MS = 1000
const showCellHoverTooltip = computed(
  () => props.cellHoverTooltip ?? props.mode === 'game',
)
const hoverTooltipCell = ref<MapCellDefinition | null>(null)
const hoverTooltipVisible = ref(false)
const hoverTooltipPos = ref({ x: 0, y: 0 })
const hoverTooltipRegionInfo = ref<RegionInfo | null>(null)
let hoverTooltipTimer: ReturnType<typeof setTimeout> | null = null
/** Клетка под курсором, с которой сейчас можно взаимодействовать. */
const hoveredInteractiveKey = ref<string | null>(null)
const hoveredGhostKey = ref<string | null>(null)

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

function isInteractiveTarget(key: string): boolean {
  if (props.mode === 'editor') return true
  if (props.interactiveKeys.includes(key)) return true
  return (
    isTokenPick(key) ||
    isTokenPicked(key) ||
    isReachable(key) ||
    isContested(key) ||
    isDestination(key) ||
    isAvailableActionMarker(key)
  )
}

function isHoveredInteractive(key: string): boolean {
  return hoveredInteractiveKey.value === key && !dragging.value
}

function regionInfoForCell(cell: MapCellDefinition): RegionInfo | null {
  if (!props.snapshot || !props.mapId) return null
  const state = gameStateFromSnapshot(props.snapshot, props.mapId)
  const region = findRegionAtCell(state, { q: cell.q, r: cell.r })
  if (!region) return null
  return getRegionInfo(state, region, {
    productionMarkers: props.snapshot.productionMarkers,
    effectiveTokenValue: (value) => value,
  })
}

function hideCellTooltip() {
  clearHoverTooltipTimer()
  hoverTooltipCell.value = null
  hoverTooltipVisible.value = false
  hoverTooltipRegionInfo.value = null
}

function onCellMouseEnter(cell: MapCellDefinition, e: MouseEvent) {
  const key = hexKey(cell.q, cell.r)
  hoveredGhostKey.value = null
  hoveredInteractiveKey.value = isInteractiveTarget(key) && !dragging.value ? key : null

  if (!showCellHoverTooltip.value) return
  clearHoverTooltipTimer()
  hoverTooltipVisible.value = false
  hoverTooltipCell.value = cell
  hoverTooltipRegionInfo.value = regionInfoForCell(cell)
  const { clientX, clientY } = e
  hoverTooltipTimer = setTimeout(() => {
    hoverTooltipPos.value = clampTooltipPos(clientX, clientY)
    hoverTooltipVisible.value = true
  }, HOVER_TOOLTIP_DELAY_MS)
}

function onCellMouseLeave() {
  hoveredInteractiveKey.value = null
  hideCellTooltip()
}

function onCellContextMenu(cell: MapCellDefinition, e: MouseEvent) {
  if (!showCellHoverTooltip.value) return
  const info = regionInfoForCell(cell)
  if (!info) return
  e.preventDefault()
  clearHoverTooltipTimer()
  hoverTooltipCell.value = cell
  hoverTooltipRegionInfo.value = info
  hoverTooltipPos.value = clampTooltipPos(e.clientX, e.clientY)
  hoverTooltipVisible.value = true
}

function onDocumentDismissTooltip(e: MouseEvent | KeyboardEvent) {
  if (!hoverTooltipVisible.value) return
  if (e instanceof KeyboardEvent && e.key !== 'Escape') return
  hideCellTooltip()
}

function onSvgContextMenu(e: MouseEvent) {
  e.preventDefault()
}

function onCellMouseMove(_cell: MapCellDefinition, e: MouseEvent) {
  if (!hoverTooltipVisible.value) return
  hoverTooltipPos.value = clampTooltipPos(e.clientX, e.clientY)
}

function onGhostMouseEnter(q: number, r: number) {
  if (dragging.value) return
  hoveredInteractiveKey.value = null
  hoveredGhostKey.value = hexKey(q, r)
}

function onGhostMouseLeave() {
  hoveredGhostKey.value = null
}

onMounted(() => {
  document.addEventListener('click', onDocumentDismissTooltip)
  document.addEventListener('keydown', onDocumentDismissTooltip)
  if (props.orientation == null) {
    internalOrientation.value = loadStoredOrientation()
  }
  if (props.autoFitOnMapChange == null) {
    internalAutoFit.value = loadStoredAutoFit()
  }
})

onUnmounted(() => {
  clearHoverTooltipTimer()
  clearPanCandidateWindowListeners()
  clearPinchWindowListeners()
  document.removeEventListener('click', onDocumentDismissTooltip)
  document.removeEventListener('keydown', onDocumentDismissTooltip)
})

const emit = defineEmits<{
  select: [q: number, r: number, mods?: { additive?: boolean }]
  addGhost: [q: number, r: number]
  'update:orientation': [orientation: HexOrientation]
  'update:autoFitOnMapChange': [enabled: boolean]
}>()

function onCellSelectClick(cell: MapCellDefinition, event: MouseEvent) {
  if (consumeSuppressClick()) return
  emit('select', cell.q, cell.r, {
    additive: event.ctrlKey || event.metaKey,
  })
}

function onGhostSelectClick(q: number, r: number) {
  if (consumeSuppressClick()) return
  emit('addGhost', q, r)
}

function isCellSelected(key: string): boolean {
  if (props.selectedKey === key) return true
  return (props.selectedKeys?.length ?? 0) > 0 && props.selectedKeys!.includes(key)
}

const size = 36
const svgRef = ref<SVGSVGElement | null>(null)
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
/** Активный сдвиг карты (после порога или ПКМ/СКМ). */
const dragging = ref(false)
/** Подавить следующий click после pan/pinch. */
let suppressNextClick = false
const PAN_THRESHOLD_PX = 8
type PanSession = {
  pointerId: number
  startX: number
  startY: number
  panX: number
  panY: number
  /** true = сразу pan (ПКМ/СКМ); false = ждём порог (ЛКМ/touch). */
  committed: boolean
}
const panSession = ref<PanSession | null>(null)
const activePointers = new Map<number, { x: number; y: number }>()
type PinchSession = {
  ids: [number, number]
  startDist: number
  startZoom: number
}
const pinchSession = ref<PinchSession | null>(null)

const internalOrientation = ref<HexOrientation>('flat')
const orientation = computed({
  get: () => props.orientation ?? internalOrientation.value,
  set: (value: HexOrientation) => {
    internalOrientation.value = value
    storeOrientation(value)
    emit('update:orientation', value)
  },
})

const internalAutoFit = ref(loadStoredAutoFit())
const autoFitOnMapChange = computed({
  get: () => props.autoFitOnMapChange ?? internalAutoFit.value,
  set: (value: boolean) => {
    internalAutoFit.value = value
    storeAutoFit(value)
    emit('update:autoFitOnMapChange', value)
  },
})

function center(q: number, r: number) {
  return hexCenter(q, r, size, orientation.value)
}

function points(q: number, r: number) {
  return hexPoints(q, r, size, orientation.value)
}

const NEUTRAL_CELL_FILL = '#6a7483'
/** Умеренная прозрачность: космос виден, клетка не «растворяется». */
const TRANSLUCENT_CELL_FILL_OPACITY = 0.68

const cellFillOpacity = computed(() =>
  props.translucentCells ? TRANSLUCENT_CELL_FILL_OPACITY : 1,
)

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
    selected: isCellSelected(key),
    'movement-source': isMovementSource(key),
    reachable: isReachable(key) && !isContested(key),
    contested: isContested(key),
    'combat-pulse': isCombatPulse(key),
    'tutorial-highlight': isTutorialHighlight(key),
    'supply-chain': isSupplyChain(key),
    'token-pick': isTokenPick(key) && !isTokenPicked(key),
    'token-picked': isTokenPicked(key),
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
    c['combat-pulse'] ||
    c['tutorial-highlight'] ||
    c['supply-chain'] ||
    c['token-pick'] ||
    c['token-picked'] ||
    c.destination ||
    c.symmetric
  )
}

type CellShipRender = {
  type: ShipType
  player: number
  id?: string
  preview?: boolean
}

function previewShipsOnCell(q: number, r: number): CellShipRender[] {
  return (props.previewPlacements ?? [])
    .filter((ship) => ship.q === q && ship.r === r)
    .map((ship) => ({
      type: ship.type,
      player: ship.player,
      preview: true,
    }))
}

function shipsOnCell(cell: MapCellDefinition): CellShipRender[] {
  const existing: CellShipRender[] = (cell.startingShips ?? []).map((ship) => ({
    type: ship.type,
    player: ship.player,
    id: boardShipId(ship),
  }))
  return [...existing, ...previewShipsOnCell(cell.q, cell.r)]
}

function shipPositions(cell: MapCellDefinition): { x: number; y: number }[] {
  const c = center(cell.q, cell.r)
  const offsets = layoutShipPositions(shipsOnCell(cell))
  return offsets.map((o) => ({ x: c.x + o.x, y: c.y + o.y }))
}

function cellShipScale(cell: MapCellDefinition): number {
  return effectiveGlyphScale(shipBoardScale(shipsOnCell(cell)), zoom.value, props.mode)
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

function isAvailableActionMarker(key: string): boolean {
  return props.availableActionMarkerKeys.includes(key)
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

function isCombatPulse(key: string): boolean {
  return props.combatPulseKeys.includes(key)
}

function isTutorialHighlight(key: string): boolean {
  return props.tutorialHighlightKeys.includes(key)
}

function isSupplyChain(key: string): boolean {
  return props.supplyChainKeys.includes(key)
}

function isTokenPick(key: string): boolean {
  return props.tokenPickKeys.includes(key)
}

function isTokenPicked(key: string): boolean {
  return props.tokenPickedKeys.includes(key)
}

function isMovementSource(key: string): boolean {
  return props.movementSourceKey != null && props.movementSourceKey === key
}

function shipAnchorAt(q: number, r: number, shipId?: string): { x: number; y: number } {
  const cell = props.cells.find((c) => c.q === q && c.r === r)
  if (!cell) return center(q, r)
  const ships = shipsOnCell(cell)
  if (!ships.length) return center(q, r)

  const positions = shipPositions(cell)
  if (shipId) {
    const idx = ships.findIndex((s) => s.id === shipId)
    if (idx >= 0 && positions[idx]) return positions[idx]
  }

  return positions.length === 1 ? positions[0] : center(q, r)
}

function cellScaleAt(q: number, r: number): number {
  const cell = props.cells.find((c) => c.q === q && c.r === r)
  return cell ? cellShipScale(cell) : 1
}

function boardShipId(ship: object): string | undefined {
  const id = (ship as { id?: unknown }).id
  return typeof id === 'string' ? id : undefined
}

const { flyingShips, isFlying } = useShipMoveTweens({
  enabled: () => props.mode === 'game',
  cells: () => props.cells,
  shipAnchor: (q, r, shipId) => shipAnchorAt(q, r, shipId),
  cellScale: (q, r) => cellScaleAt(q, r),
  layoutEpoch: () => orientation.value,
  interruptEpoch: () => props.observationRevision,
})

const incomingShipIdSet = computed(() => new Set(props.incomingShipIds))
const activeShipIdSet = computed(() => new Set(props.activeShipIds))

const combatGhostGroups = computed(() => {
  const groups = new Map<string, typeof props.combatGhosts>()
  for (const ghost of props.combatGhosts) {
    const key = hexKey(ghost.q, ghost.r)
    const list = groups.get(key) ?? []
    list.push(ghost)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([key, ghosts]) => {
    const first = ghosts[0]!
    const c = center(first.q, first.r)
    const offsets = layoutShipPositions(ghosts)
    return {
      key,
      items: ghosts.map((ghost, idx) => ({
        ghost,
        x: c.x + (offsets[idx]?.x ?? 0),
        y: c.y + (offsets[idx]?.y ?? 0),
        scale: shipBoardScale(ghosts),
      })),
    }
  })
})

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

function consumeSuppressClick(): boolean {
  if (!suppressNextClick) return false
  suppressNextClick = false
  return true
}

function clientToViewScale(): { scaleX: number; scaleY: number } {
  const rect = svgRef.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return { scaleX: 1, scaleY: 1 }
  }
  const viewParts = displayViewBox.value.split(' ').map(Number)
  const viewW = viewParts[2] ?? 100
  const viewH = viewParts[3] ?? 100
  return { scaleX: viewW / rect.width, scaleY: viewH / rect.height }
}

function applyPanFromSession(clientX: number, clientY: number, session: PanSession) {
  const { scaleX, scaleY } = clientToViewScale()
  pan.value = {
    x: session.panX - (clientX - session.startX) * scaleX,
    y: session.panY - (clientY - session.startY) * scaleY,
  }
}

function beginCommittedPan(session: PanSession) {
  session.committed = true
  dragging.value = true
  suppressNextClick = true
  hoveredInteractiveKey.value = null
  hoveredGhostKey.value = null
  hideCellTooltip()
}

function pointerDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function tryStartPinch() {
  if (!props.zoomable || activePointers.size < 2) return
  const entries = [...activePointers.entries()]
  const [idA, a] = entries[0]!
  const [idB, b] = entries[1]!
  const dist = pointerDistance(a, b)
  if (dist < 1) return
  clearPanCandidateWindowListeners()
  panSession.value = null
  dragging.value = false
  pinchSession.value = {
    ids: [idA, idB],
    startDist: dist,
    startZoom: zoom.value,
  }
  suppressNextClick = true
  hoveredInteractiveKey.value = null
  hoveredGhostKey.value = null
  hideCellTooltip()
  bindPinchWindowListeners()
}

function updatePinch() {
  const session = pinchSession.value
  if (!session) return
  const a = activePointers.get(session.ids[0])
  const b = activePointers.get(session.ids[1])
  if (!a || !b) return
  const dist = pointerDistance(a, b)
  if (dist < 1 || session.startDist < 1) return
  zoom.value = clampZoom(session.startZoom * (dist / session.startDist))
}

function clearPinchWindowListeners() {
  if (!import.meta.client) return
  window.removeEventListener('pointermove', onWindowPinchMove)
  window.removeEventListener('pointerup', onWindowPinchEnd)
  window.removeEventListener('pointercancel', onWindowPinchEnd)
}

function bindPinchWindowListeners() {
  if (!import.meta.client) return
  clearPinchWindowListeners()
  window.addEventListener('pointermove', onWindowPinchMove, { passive: false })
  window.addEventListener('pointerup', onWindowPinchEnd)
  window.addEventListener('pointercancel', onWindowPinchEnd)
}

function onWindowPinchMove(e: PointerEvent) {
  if (!pinchSession.value) return
  if (!activePointers.has(e.pointerId)) return
  e.preventDefault()
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  updatePinch()
}

function onWindowPinchEnd(e: PointerEvent) {
  if (!pinchSession.value) return
  if (!pinchSession.value.ids.includes(e.pointerId) && !activePointers.has(e.pointerId)) {
    return
  }
  endPointerTracking(e)
}

function clearPanCandidateWindowListeners() {
  if (!import.meta.client) return
  window.removeEventListener('pointermove', onWindowPanCandidateMove)
  window.removeEventListener('pointerup', onWindowPanCandidateEnd)
  window.removeEventListener('pointercancel', onWindowPanCandidateEnd)
}

function bindPanCandidateWindowListeners() {
  if (!import.meta.client) return
  clearPanCandidateWindowListeners()
  window.addEventListener('pointermove', onWindowPanCandidateMove)
  window.addEventListener('pointerup', onWindowPanCandidateEnd)
  window.addEventListener('pointercancel', onWindowPanCandidateEnd)
}

function onWindowPanCandidateMove(e: PointerEvent) {
  const session = panSession.value
  if (!session || session.committed || session.pointerId !== e.pointerId) return
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  const dist = Math.hypot(e.clientX - session.startX, e.clientY - session.startY)
  if (dist < PAN_THRESHOLD_PX) return
  beginCommittedPan(session)
  clearPanCandidateWindowListeners()
  if (svgRef.value) {
    try {
      svgRef.value.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }
  applyPanFromSession(e.clientX, e.clientY, session)
}

function onWindowPanCandidateEnd(e: PointerEvent) {
  const session = panSession.value
  if (!session || session.pointerId !== e.pointerId) return
  if (!session.committed) {
    clearPanCandidateWindowListeners()
    activePointers.delete(e.pointerId)
    panSession.value = null
  }
}

function endPointerTracking(e: PointerEvent) {
  activePointers.delete(e.pointerId)
  const targets: Array<Element | null> = [e.currentTarget as Element | null, svgRef.value]
  for (const target of targets) {
    if (target?.hasPointerCapture?.(e.pointerId)) {
      try {
        target.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
    }
  }
  if (panSession.value?.pointerId === e.pointerId) {
    if (!panSession.value.committed) {
      clearPanCandidateWindowListeners()
    }
    panSession.value = null
    dragging.value = false
  }
  const pinch = pinchSession.value
  if (pinch && (pinch.ids.includes(e.pointerId) || activePointers.size < 2)) {
    pinchSession.value = null
    clearPinchWindowListeners()
  }
  if (activePointers.size === 1 && props.zoomable && !pinchSession.value) {
    const [pointerId, pt] = [...activePointers.entries()][0]!
    panSession.value = {
      pointerId,
      startX: pt.x,
      startY: pt.y,
      panX: pan.value.x,
      panY: pan.value.y,
      committed: true,
    }
    dragging.value = true
    suppressNextClick = true
  }
}

function onWheel(e: WheelEvent) {
  if (!props.zoomable) return
  e.preventDefault()
  zoomBy(e.deltaY > 0 ? 0.9 : 1.1)
}

function onPointerDown(e: PointerEvent) {
  if (!props.zoomable) return
  // Игнор лишних кнопок мыши (назад/вперёд).
  if (e.pointerType === 'mouse' && e.button > 2) return

  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

  if (activePointers.size >= 2) {
    e.preventDefault()
    clearPanCandidateWindowListeners()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    for (const id of activePointers.keys()) {
      try {
        ;(e.currentTarget as Element).setPointerCapture(id)
      } catch {
        /* ignore */
      }
    }
    tryStartPinch()
    return
  }

  // ПКМ / СКМ — сразу pan (как раньше для ПКМ).
  if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) {
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const session: PanSession = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.value.x,
      panY: pan.value.y,
      committed: true,
    }
    panSession.value = session
    beginCommittedPan(session)
    return
  }

  // ЛКМ / touch / pen — кандидат на pan; клик по клетке, если не превысили порог.
  if (e.button === 0 || e.pointerType !== 'mouse') {
    panSession.value = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.value.x,
      panY: pan.value.y,
      committed: false,
    }
    bindPanCandidateWindowListeners()
  }
}

function onPointerMove(e: PointerEvent) {
  if (!props.zoomable) return
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }

  if (pinchSession.value && activePointers.size >= 2) {
    e.preventDefault()
    updatePinch()
    return
  }

  const session = panSession.value
  if (!session || session.pointerId !== e.pointerId || !session.committed) return

  e.preventDefault()
  applyPanFromSession(e.clientX, e.clientY, session)
}

function onPointerUp(e: PointerEvent) {
  endPointerTracking(e)
}

function onPointerCancel(e: PointerEvent) {
  endPointerTracking(e)
  suppressNextClick = true
}
</script>

<template>
  <div
    class="hex-board-wrap"
    :class="{
      'fill-viewport': fillViewport,
      overlay: toolbarPlacement === 'overlay',
      'hex-board-wrap--translucent': translucentCells,
      'hex-board-wrap--game': mode === 'game',
    }"
  >
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
          :aria-pressed="autoFitOnMapChange"
          title="Подгонять масштаб под всю карту при правке. Выключите, чтобы зум и сдвиг оставались как вы их поставили."
          @click="autoFitOnMapChange = !autoFitOnMapChange"
        >
          Подгонять
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
        'hex-board--translucent': translucentCells,
      }"
      xmlns="http://www.w3.org/2000/svg"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @contextmenu="onSvgContextMenu"
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

      <!-- SVG paint order (bottom → top): fills → territory → content → outlines → hover -->
      <PlayerTerritoryLabels
        :cells="cells"
        :players="territoryLabelPlayers"
        :hex-size="size"
        :orientation="orientation"
      />

      <g v-for="g in ghosts" :key="'g' + hexKey(g.q, g.r)">
        <polygon
          :points="points(g.q, g.r)"
          class="ghost"
          :class="{ 'ghost--hover': hoveredGhostKey === hexKey(g.q, g.r) && !dragging }"
          @click="onGhostSelectClick(g.q, g.r)"
          @mouseenter="onGhostMouseEnter(g.q, g.r)"
          @mouseleave="onGhostMouseLeave"
        />
        <text :x="center(g.q, g.r).x" :y="center(g.q, g.r).y" class="ghost-label">+</text>
      </g>

      <g v-for="cell in cells" :key="hexKey(cell.q, cell.r)">
        <polygon
          :points="points(cell.q, cell.r)"
          :class="{
            hex: true,
            owned: cell.startPlayer != null,
            interactive: isInteractiveTarget(hexKey(cell.q, cell.r)),
          }"
          :fill="NEUTRAL_CELL_FILL"
          :fill-opacity="cellFillOpacity"
          @click="onCellSelectClick(cell, $event)"
          @mouseenter="onCellMouseEnter(cell, $event)"
          @mouseleave="onCellMouseLeave"
          @mousemove="onCellMouseMove(cell, $event)"
          @contextmenu="onCellContextMenu(cell, $event)"
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
          v-if="isCombatPulse(hexKey(cell.q, cell.r))"
          :points="points(cell.q, cell.r)"
          class="hex-overlay hex-overlay--combat-pulse"
          pointer-events="none"
        />
        <polygon
          v-if="isTutorialHighlight(hexKey(cell.q, cell.r))"
          :points="points(cell.q, cell.r)"
          class="hex-overlay hex-overlay--tutorial-highlight"
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

        <template v-if="props.siegeMarks[hexKey(cell.q, cell.r)]">
          <!-- Осада: «зубчатое» кольцо и значок цвета осаждающего. Неподвижно, в отличие от
               бегущего пунктира «перейдёт на следующий ход». -->
          <polygon
            :points="insetHexPoints(cell.q, cell.r, 0.97)"
            class="hex-siege-ring"
            :stroke="props.siegeMarks[hexKey(cell.q, cell.r)]?.color"
            pointer-events="none"
          />
          <g
            class="hex-siege-badge"
            :transform="`translate(${center(cell.q, cell.r).x - size * 0.42}, ${center(cell.q, cell.r).y - size * 0.6})`"
            pointer-events="none"
          >
            <circle r="7.5" :stroke="props.siegeMarks[hexKey(cell.q, cell.r)]?.color" />
            <path d="M-4,-4 L4,4 M4,-4 L-4,4 M-4.8,1.4 L-1.4,4.8 M4.8,1.4 L1.4,4.8" />
          </g>
        </template>

        <polygon
          v-if="props.captureAhead[hexKey(cell.q, cell.r)]"
          :points="insetHexPoints(cell.q, cell.r, 0.9)"
          class="hex-capture-ahead"
          :stroke="props.captureAhead[hexKey(cell.q, cell.r)]?.color"
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
          :action-marker-available="isAvailableActionMarker(hexKey(cell.q, cell.r))"
          :token-pickable="isTokenPick(hexKey(cell.q, cell.r))"
          :token-picked="isTokenPicked(hexKey(cell.q, cell.r))"
        />
      </g>

      <g class="hex-ships-layer" aria-hidden="true">
        <g v-for="cell in cells" :key="'ships-' + hexKey(cell.q, cell.r)">
          <g v-if="shipsOnCell(cell).length">
            <g
              v-for="(ship, idx) in shipsOnCell(cell)"
              v-show="!isFlying(ship.id)"
              :key="ship.id ?? `preview-${hexKey(cell.q, cell.r)}-${idx}`"
              :transform="`translate(${shipPositions(cell)[idx].x}, ${shipPositions(cell)[idx].y})`"
            >
              <g
                :class="{
                  'ship-preview-glyph': ship.preview,
                  'ship-preview-glyph--pulse': ship.preview && previewPlacementsPulse,
                  'ship-incoming-glyph': !!ship.id && incomingShipIdSet.has(ship.id),
                  'ship-active-move-glyph': !!ship.id && activeShipIdSet.has(ship.id),
                }"
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
      </g>

      <g class="hex-ships-fly-layer" aria-hidden="true" pointer-events="none">
        <g
          v-for="fly in flyingShips"
          :key="'fly-' + fly.id"
          :transform="`translate(${fly.x}, ${fly.y})`"
        >
          <ShipGlyph
            :type="fly.type"
            :player-color="PLAYER_COLORS[fly.player] ?? '#888'"
            :scale="fly.scale"
          />
        </g>
      </g>

      <g class="hex-ships-ghost-layer" aria-hidden="true" pointer-events="none">
        <g v-for="group in combatGhostGroups" :key="'ghosts-' + group.key">
          <g
            v-for="item in group.items"
            :key="'ghost-' + item.ghost.id"
            class="ship-death-glyph"
            :transform="`translate(${item.x}, ${item.y})`"
          >
            <ShipGlyph
              :type="item.ghost.type"
              :player-color="PLAYER_COLORS[item.ghost.player] ?? '#888'"
              :scale="item.scale"
            />
            <path
              class="ship-death-crack"
              d="M-7,-7 L7,7 M7,-7 L-7,7"
              fill="none"
            />
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

      <!-- Hover поверх границ регионов, маркеров и прочих обводок -->
      <g class="hex-hover-layer" pointer-events="none" aria-hidden="true">
        <template v-for="cell in cells" :key="'hover-' + hexKey(cell.q, cell.r)">
          <polygon
            v-if="isHoveredInteractive(hexKey(cell.q, cell.r))"
            :points="points(cell.q, cell.r)"
            class="hex-overlay hex-overlay--interactive-hover"
          />
        </template>
      </g>
    </svg>

    <Teleport to="body">
      <RegionCellTooltip
        v-if="showCellHoverTooltip && hoverTooltipVisible && hoverTooltipCell"
        :cell="hoverTooltipCell"
        :region-info="hoverTooltipRegionInfo"
        :players="players"
        :capture-note="props.captureAhead[hexKey(hoverTooltipCell.q, hoverTooltipCell.r)]?.note ?? null"
        :siege-note="props.siegeMarks[hexKey(hoverTooltipCell.q, hoverTooltipCell.r)]?.note ?? null"
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
  top: auto;
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
  height: auto;
  width: max-content;
}
/* Игровая комната на узком экране: зум только щипком, без колонки контролов */
@media (max-width: 900px) {
  .hex-board-wrap--game.overlay .zoom-bar--overlay {
    display: none !important;
  }
  .hex-board-wrap.fill-viewport {
    touch-action: none;
  }
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
.hex-board--translucent {
  background: transparent;
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
  cursor: default;
  opacity: 0.95;
  transition: stroke 0.12s ease, stroke-width 0.12s ease;
}
.hex.interactive {
  cursor: pointer;
}
.hex-board-wrap--translucent .hex {
  opacity: 1;
  stroke: rgba(148, 163, 184, 0.55);
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
  pointer-events: none;
}
.hex-overlay:not(.hex-overlay--interactive-hover) {
  stroke: none;
}
.hex-overlay--reachable {
  /* Magenta: контраст с зелёным/синим/красным/фиолетовым/янтарным/бирюзовым контролем */
  fill: rgba(232, 121, 249, 0.28);
}
.hex-overlay--destination {
  fill: rgba(250, 204, 21, 0.34);
}
.hex-overlay--contested {
  fill: rgba(248, 113, 113, 0.32);
}
.hex-overlay--combat-pulse {
  fill: rgba(248, 113, 113, 0.22);
  animation: combat-hex-pulse 1.15s ease-in-out infinite;
}
.hex-overlay--tutorial-highlight {
  /* Непрозрачный rgb + fill-opacity: иначе rgba × fill-opacity почти незаметен */
  fill: rgb(56, 189, 248);
  stroke: rgb(186, 230, 253);
  stroke-width: 3.2;
  animation: tutorial-hex-pulse 1.15s ease-in-out infinite;
}
.hex-overlay--interactive-hover {
  fill: rgba(255, 255, 255, 0.18);
  stroke: rgba(248, 250, 252, 0.98);
  stroke-width: 2.8;
  filter: drop-shadow(0 0 6px rgba(226, 232, 240, 0.65));
  transition: fill 0.12s ease, stroke 0.12s ease;
}
.hex-hover-layer {
  pointer-events: none;
}
.hex.reachable {
  stroke: rgba(232, 121, 249, 0.95);
  stroke-width: 2.4;
}
.hex.contested {
  stroke: rgba(248, 113, 113, 0.95);
  stroke-width: 2.5;
}
.hex.combat-pulse {
  stroke: rgba(248, 113, 113, 1);
  stroke-width: 3.1;
  filter: drop-shadow(0 0 6px rgba(248, 113, 113, 0.7));
}
.hex.tutorial-highlight {
  stroke: rgb(125, 211, 252);
  stroke-width: 3.2;
  filter: drop-shadow(0 0 7px rgba(56, 189, 248, 0.85));
  animation: tutorial-outline-pulse 1.15s ease-in-out infinite;
}
/* Осада: неподвижное «зубчатое» кольцо и значок со скрещёнными клинками цвета осаждающего. */
.hex-siege-ring {
  fill: none;
  stroke-width: 4.5;
  stroke-dasharray: 5 3.5;
  stroke-linecap: butt;
  filter: drop-shadow(0 0 3px rgba(15, 23, 42, 0.95));
}
.hex-siege-badge circle {
  fill: #0f172a;
  stroke-width: 2;
}
.hex-siege-badge path {
  fill: none;
  stroke: #f8fafc;
  stroke-width: 1.6;
  stroke-linecap: round;
}
/* Центр власти сменит хозяина в начале следующего хода: бегущий пунктир цвета захватчика. */
.hex-capture-ahead {
  fill: none;
  stroke-width: 3;
  stroke-dasharray: 7 5;
  stroke-linejoin: round;
  animation: capture-ahead-march 1.4s linear infinite;
  filter: drop-shadow(0 0 3px rgba(15, 23, 42, 0.9));
}
@keyframes capture-ahead-march {
  to {
    stroke-dashoffset: -24;
  }
}
@media (prefers-reduced-motion: reduce) {
  .hex-capture-ahead {
    animation: none;
  }
}
.hex.token-pick {
  stroke: #facc15;
  stroke-width: 2.4;
  stroke-dasharray: 5 3;
  opacity: 0.95;
}
.hex.token-picked {
  stroke: #f472b6;
  stroke-width: 3.2;
  filter: drop-shadow(0 0 5px rgba(244, 114, 182, 0.65));
}
.hex.supply-chain {
  stroke: rgba(52, 211, 153, 0.75);
  stroke-width: 2;
}
.hex.destination {
  stroke: rgba(250, 204, 21, 0.98);
  stroke-width: 2.8;
}
.move-preview-line {
  fill: none;
  stroke: rgba(250, 204, 21, 0.9);
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
.hex-marker-ring--action.hex-marker-ring--available {
  animation: marker-ring-available 1.55s ease-in-out infinite;
  filter: drop-shadow(0 0 5px rgba(254, 240, 138, 0.65));
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
.hex-board--zoomed-out .hex-marker-ring--action {
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
  transition: fill 0.12s ease, stroke 0.12s ease;
}
.ghost--hover {
  fill: rgba(56, 189, 248, 0.2);
  stroke: #7dd3fc;
  filter: drop-shadow(0 0 5px rgba(125, 211, 252, 0.5));
}
.ghost-label {
  fill: #94a3b8;
  font-size: 14px;
  text-anchor: middle;
  dominant-baseline: middle;
  pointer-events: none;
}
.hex-ships-layer,
.hex-ships-fly-layer,
.hex-ships-ghost-layer {
  pointer-events: none;
}
.ship-incoming-glyph {
  animation: ship-incoming-pulse 1.1s ease-in-out infinite;
  filter: drop-shadow(0 0 5px rgba(248, 113, 113, 0.9));
}
.ship-death-glyph {
  animation: ship-death 1.05s ease-out forwards;
  transform-box: fill-box;
  transform-origin: center;
}
.ship-death-crack {
  stroke: #fecaca;
  stroke-width: 1.6;
  stroke-linecap: round;
  opacity: 0.9;
}
@keyframes combat-hex-pulse {
  0%,
  100% {
    fill-opacity: 0.35;
  }
  50% {
    fill-opacity: 0.85;
  }
}
@keyframes tutorial-hex-pulse {
  0%,
  100% {
    fill-opacity: 0.1;
    stroke-opacity: 0.35;
  }
  50% {
    fill-opacity: 0.48;
    stroke-opacity: 1;
  }
}
@keyframes tutorial-outline-pulse {
  0%,
  100% {
    stroke-opacity: 0.35;
    stroke-width: 2.4;
    filter: drop-shadow(0 0 2px rgba(56, 189, 248, 0.25));
  }
  50% {
    stroke-opacity: 1;
    stroke-width: 3.6;
    filter: drop-shadow(0 0 10px rgba(56, 189, 248, 0.95));
  }
}
@keyframes ship-incoming-pulse {
  0%,
  100% {
    opacity: 0.85;
  }
  50% {
    opacity: 1;
  }
}
@keyframes ship-death {
  0% {
    opacity: 1;
    filter: none;
    transform: scale(1);
  }
  40% {
    opacity: 1;
    filter: grayscale(0.25) brightness(1.15);
    transform: scale(1.18) rotate(-8deg);
  }
  100% {
    opacity: 0.42;
    filter: grayscale(0.85) brightness(1.2);
    transform: scale(0.82) rotate(8deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .hex-overlay--combat-pulse,
  .hex-overlay--tutorial-highlight,
  .hex.tutorial-highlight,
  .ship-incoming-glyph,
  .ship-active-move-glyph,
  .ship-death-glyph {
    animation: none;
  }
  .hex-overlay--tutorial-highlight {
    fill-opacity: 0.32;
    stroke-opacity: 0.95;
  }
  .hex.tutorial-highlight {
    stroke-opacity: 1;
    stroke-width: 3.2;
    filter: drop-shadow(0 0 7px rgba(56, 189, 248, 0.85));
  }
  .ship-death-glyph {
    opacity: 0.45;
    filter: grayscale(0.6);
  }
  .ship-active-move-glyph {
    filter: drop-shadow(0 0 4px rgba(249, 168, 212, 0.85));
    opacity: 1;
  }
}
.ship-preview-glyph {
  opacity: 0.9;
  transform-box: fill-box;
  transform-origin: center;
}
.ship-preview-glyph--pulse {
  opacity: 1;
  animation: production-ship-grow-shrink 0.7s ease-in-out 2;
}
/** Активный корабль при выборе назначения — как неразмещённый в полоске производства. */
.ship-active-move-glyph {
  opacity: 0.9;
  transform-box: fill-box;
  transform-origin: center;
  animation: ship-place-wait-pulse 1.05s ease-in-out infinite;
}
@keyframes production-ship-grow-shrink {
  0%,
  100% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.35);
  }
  70% {
    transform: scale(0.9);
  }
}
@keyframes ship-place-wait-pulse {
  0%,
  100% {
    transform: scale(1);
    filter: none;
  }
  50% {
    transform: scale(1.16);
    filter: drop-shadow(0 0 4px rgba(249, 168, 212, 0.85));
  }
}
@media (prefers-reduced-motion: reduce) {
  .ship-active-move-glyph {
    animation: none;
    filter: drop-shadow(0 0 4px rgba(249, 168, 212, 0.85));
    opacity: 1;
  }
}
</style>
