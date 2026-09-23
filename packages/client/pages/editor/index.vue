<script setup lang="ts">
import type { MapCellContent, MapDefinition, GameSnapshot, ResourceTokenDef, ResourceTokenValue, ShipType } from '@galaxy/rules'
import {
  MAX_SHIPS_PER_CELL,
  MAX_SHIPS_PER_CELL_PER_PLAYER,
  PLAYER_COLORS,
  PLAYER_LABELS,
  SHIP_LABELS,
  SHIP_TYPES,
  DEFAULT_SYMMETRY_SETTINGS,
  getSymmetryAxisLabels,
  horizontalThroughCentersPossible,
  SYMMETRY_PLAYER_OPTIONS,
  addCellOrbit,
  applyCellContent,
  canAddShipToCell,
  countCellShipsForPlayer,
  createEmptyMap,
  expandMapStructure,
  extractCellContent,
  getCellResourceToken,
  getGhostSlots,
  hexKey,
  normalizeMapDefinition,
  orbitKeysForCell,
  parseHexKey,
  removeCellOrbit,
  renderAsciiMapFromDefinition,
  setCellResourceToken,
  syncCellControlWithShips,
  syncCellOrbitContent,
  inferMapPlayerCount,
  MAX_LOBBY_PLAYERS,
  type SymmetrySettings,
  type GalaxySaveFile,
  galaxySaveFromMap,
  galaxySaveDownloadFileName,
  parseGalaxySave,
  serializeGalaxySave,
  mapBalanceWarnings,
  validateMapDefinition,
} from '@galaxy/rules'
import { submitMapForModeration } from '~/composables/useGameApi'
import { usePlayerProfile } from '~/composables/usePlayerProfile'
import { loadStoredOrientation, storeOrientation, type HexOrientation } from '~/utils/hex-layout'
import { useUiStrings } from '~/i18n/ui-strings'

definePageMeta({ layout: 'immersive' })

const { nickname } = usePlayerProfile()
const moderationMessage = ref<string | null>(null)

const SYMMETRY_STORAGE_KEY = 'galaxy-editor-symmetry'

const map = ref<MapDefinition>(normalizeMapDefinition(createEmptyMap('draft', 'Черновик')))
const importedGame = ref<GameSnapshot | null>(null)
/** Порядок: последний — «якорная» клетка для панели */
const selectedKeys = ref<string[]>([hexKey(0, 0)])
const selectedKey = computed({
  get: () => selectedKeys.value[selectedKeys.value.length - 1] ?? null,
  set: (key: string | null) => {
    selectedKeys.value = key ? [key] : []
  },
})
const selectedCount = computed(() => selectedKeys.value.length)
const storageKey = 'galaxy-maps'
const savedMaps = ref<MapDefinition[]>([])
const loadMapId = ref('')
const showAscii = ref(false)
const panelTab = ref<'cell' | 'symmetry' | 'file' | 'help'>('cell')
const panelCollapsed = ref(false)

const boardCells = computed(() => map.value.cells)

const newShipType = ref<ShipType>('destroyer')
const newShipPlayer = ref(1)
type ClipboardPayload = {
  anchor: { q: number; r: number }
  entries: { dq: number; dr: number; content: MapCellContent }[]
}
const cellClipboard = ref<ClipboardPayload | null>(null)
const hasCellClipboard = computed(() => cellClipboard.value != null)
const boardFocusRef = ref<HTMLElement | null>(null)
const editorUi = useUiStrings().editor
/** Полоса горячих клавиш свёрнута или развёрнута */
const hotkeysOpen = ref(true)

function loadSymmetrySettings(): SymmetrySettings {
  if (!import.meta.client) return { ...DEFAULT_SYMMETRY_SETTINGS }
  try {
    const stored = JSON.parse(localStorage.getItem(SYMMETRY_STORAGE_KEY) ?? 'null') as Partial<SymmetrySettings> | null
    if (!stored) return { ...DEFAULT_SYMMETRY_SETTINGS }
    return {
      ...DEFAULT_SYMMETRY_SETTINGS,
      ...stored,
      playerCount: stored.playerCount === 3 || stored.playerCount === 4 || stored.playerCount === 6
        ? stored.playerCount
        : 2,
      axisKind: stored.axisKind === 'edge' ? 'edge' : 'line',
      axisIndex: stored.axisIndex != null && stored.axisIndex >= 0 && stored.axisIndex <= 2
        ? stored.axisIndex
        : 0,
    }
  } catch {
    return { ...DEFAULT_SYMMETRY_SETTINGS }
  }
}

const symmetry = ref<SymmetrySettings>(loadSymmetrySettings())

const { pushHistory, undo, redo, canUndo, resetHistory } = useMapEditorHistory(map, selectedKey)

const cellMap = computed(() => new Map(map.value.cells.map((c) => [hexKey(c.q, c.r), c])))
const ghosts = computed(() => getGhostSlots(map.value))
const asciiPreview = computed(() => renderAsciiMapFromDefinition(map.value))
const errors = computed(() => validateMapDefinition(map.value))
/** Неравный старт не ошибка — учебные карты асимметричны намеренно, — но о нём стоит знать. */
const balanceWarnings = computed(() => mapBalanceWarnings(map.value))

const selectedCell = computed(() =>
  selectedKey.value ? cellMap.value.get(selectedKey.value) : undefined,
)

const selectedToken = computed(() =>
  selectedCell.value ? getCellResourceToken(selectedCell.value) : undefined,
)

const tokenPreview = computed((): ResourceTokenDef | null => {
  if (tokenKind.value === 'none') return null
  return {
    type: tokenKind.value as 'credits' | 'production',
    value: tokenValue.value as ResourceTokenValue,
    faceUp: true,
  }
})

const tokenKind = computed({
  get: () => selectedToken.value?.type ?? 'none',
  set: (kind: 'none' | 'credits' | 'production') => {
    const cells = selectedCellsList()
    if (!cells.length) return
    pushHistory()
    for (const cell of cells) {
      if (kind === 'none') {
        setCellResourceToken(cell, undefined)
      } else {
        const value = getCellResourceToken(cell)?.value ?? 3
        setCellResourceToken(cell, { type: kind, value, faceUp: true })
      }
      syncSymmetryOrbitFor(cell.q, cell.r)
    }
  },
})

const tokenValue = computed({
  get: () => selectedToken.value?.value ?? 3,
  set: (value: number) => {
    const cells = selectedCellsList()
    if (!cells.length || tokenKind.value === 'none') return
    const clamped = Math.min(9, Math.max(1, Math.round(value))) as ResourceTokenValue
    pushHistory()
    for (const cell of cells) {
      setCellResourceToken(cell, {
        type: tokenKind.value as 'credits' | 'production',
        value: clamped,
        faceUp: true,
      })
      syncSymmetryOrbitFor(cell.q, cell.r)
    }
  },
})

const shipCount = computed(() => selectedCell.value?.startingShips?.length ?? 0)
const shipsFull = computed(() => {
  const cells = selectedCellsList()
  if (!cells.length) return true
  return cells.every((cell) => !canAddShipToCell(cell, newShipPlayer.value))
})

const playerShipCount = computed(() =>
  selectedCell.value ? countCellShipsForPlayer(selectedCell.value, newShipPlayer.value) : 0,
)

const mapPlayerCount = computed({
  get: () => map.value.playerCount ?? inferMapPlayerCount(map.value),
  set: (value: number) => {
    map.value.playerCount = Math.min(MAX_LOBBY_PLAYERS, Math.max(1, value))
  },
})

const playerSlots = computed(() =>
  Array.from({ length: mapPlayerCount.value }, (_, i) => i + 1),
)

const symmetryHint = computed(
  () => SYMMETRY_PLAYER_OPTIONS.find((opt) => opt.count === symmetry.value.playerCount)?.hint ?? '',
)

const boardOrientation = ref<HexOrientation>(loadStoredOrientation())

const symmetryAxisLabels = computed(() =>
  getSymmetryAxisLabels(symmetry.value.axisKind, boardOrientation.value),
)

const showSymmetryAxisControls = computed(
  () => symmetry.value.playerCount === 2 || symmetry.value.playerCount === 4,
)

const horizontalThroughCentersHint = computed(() => {
  if (!showSymmetryAxisControls.value) return ''
  if (symmetry.value.axisKind !== 'line') return ''
  if (horizontalThroughCentersPossible(boardOrientation.value)) return ''
  return 'Горизонтальное зеркало через центры клеток в этой ориентации карты невозможно: гексы стоят гранью вверх и не выстраиваются в горизонтальный ряд центров. Переключите поле на «углом вверх» — тогда появится кнопка «горизонталь».'
})

function setBoardOrientation(orientation: HexOrientation) {
  boardOrientation.value = orientation
  storeOrientation(orientation)
}

const symmetryOrbitKeys = computed(() => {
  if (!symmetry.value.enabled || !selectedKey.value) return [] as string[]
  const { q, r } = parseHexKey(selectedKey.value)
  return orbitKeysForCell({ q, r }, symmetry.value)
})

watch(
  symmetry,
  (value) => {
    if (import.meta.client) {
      localStorage.setItem(SYMMETRY_STORAGE_KEY, JSON.stringify(value))
    }
  },
  { deep: true },
)

watch(
  () => [symmetry.value.enabled, symmetry.value.playerCount, symmetry.value.axisKind, symmetry.value.axisIndex] as const,
  (current, previous) => {
    if (!current[0] || !previous) return
    pushHistory()
    expandMapStructure(map.value, symmetry.value)
  },
)

onMounted(() => {
  refreshSavedMaps()
  boardFocusRef.value?.focus({ preventScroll: true })
})

function focusBoard() {
  boardFocusRef.value?.focus({ preventScroll: true })
}

function syncSymmetryOrbit() {
  if (!selectedKey.value) return
  const { q, r } = parseHexKey(selectedKey.value)
  syncSymmetryOrbitFor(q, r)
}

function syncSymmetryOrbitFor(q: number, r: number) {
  if (!symmetry.value.enabled) return
  syncCellOrbitContent(map.value, { q, r }, symmetry.value)
}

function selectedCellsList() {
  return selectedKeys.value
    .map((key) => cellMap.value.get(key))
    .filter((c): c is NonNullable<typeof c> => !!c)
}

function expandSymmetryStructure() {
  if (!symmetry.value.enabled) return
  pushHistory()
  expandMapStructure(map.value, symmetry.value)
}

function onSymmetryEnabledChange(enabled: boolean) {
  pushHistory()
  symmetry.value.enabled = enabled
  if (enabled) expandMapStructure(map.value, symmetry.value)
}

function refreshSavedMaps() {
  const raw = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown[]
  savedMaps.value = raw.map((entry) => {
    try {
      return parseGalaxySave(entry).map
    } catch {
      return normalizeMapDefinition(entry as MapDefinition)
    }
  })
}

function loadSaveToEditor(save: GalaxySaveFile) {
  map.value = normalizeMapDefinition(JSON.parse(JSON.stringify(save.map)) as MapDefinition)
  importedGame.value = save.game ? (JSON.parse(JSON.stringify(save.game)) as GameSnapshot) : null
  selectedKey.value = hexKey(map.value.cells[0]?.q ?? 0, map.value.cells[0]?.r ?? 0)
  resetHistory()
}

const { persistNow: persistEditorDraftNow } = useEditorDraft(map, selectedKey, importedGame, (draft) => {
  loadSaveToEditor(draft.save)
  if (draft.selectedKey) {
    const exists = map.value.cells.some((c) => hexKey(c.q, c.r) === draft.selectedKey)
    if (exists) selectedKey.value = draft.selectedKey
  }
})

function selectCell(q: number, r: number, mods?: { additive?: boolean }) {
  const key = hexKey(q, r)
  if (mods?.additive) {
    const idx = selectedKeys.value.indexOf(key)
    if (idx >= 0) {
      if (selectedKeys.value.length === 1) return
      selectedKeys.value = selectedKeys.value.filter((k) => k !== key)
    } else {
      selectedKeys.value = [...selectedKeys.value, key]
    }
  } else {
    selectedKeys.value = [key]
  }
  focusBoard()
}

function selectAllCells() {
  selectedKeys.value = map.value.cells.map((c) => hexKey(c.q, c.r))
  focusBoard()
}

function addCell(q: number, r: number) {
  pushHistory()
  addCellOrbit(map.value, { q, r }, symmetry.value)
  selectedKeys.value = [hexKey(q, r)]
  focusBoard()
}

function removeSelected() {
  const keys = [...selectedKeys.value]
  if (!keys.length) return
  if (!symmetry.value.enabled && map.value.cells.length <= keys.length) return
  pushHistory()
  for (const key of keys) {
    const { q, r } = parseHexKey(key)
    removeCellOrbit(map.value, { q, r }, symmetry.value)
  }
  if (!map.value.cells.length) {
    map.value = normalizeMapDefinition(createEmptyMap(map.value.id, map.value.name))
  }
  selectedKeys.value = [hexKey(map.value.cells[0].q, map.value.cells[0].r)]
  focusBoard()
}

function togglePowerCenter() {
  const cells = selectedCellsList()
  if (!cells.length) return
  const next = !cells[0]!.isPowerCenter
  pushHistory()
  for (const cell of cells) {
    cell.isPowerCenter = next
    syncSymmetryOrbitFor(cell.q, cell.r)
  }
}

function setStartPlayer(player: number | null) {
  const cells = selectedCellsList()
  if (!cells.length) return
  pushHistory()
  for (const cell of cells) {
    cell.startPlayer = player
    syncSymmetryOrbitFor(cell.q, cell.r)
  }
}

function addShip() {
  const cells = selectedCellsList()
  if (!cells.length) return
  pushHistory()
  for (const cell of cells) {
    if (!canAddShipToCell(cell, newShipPlayer.value)) continue
    if (!cell.startingShips) cell.startingShips = []
    cell.startingShips.push({
      type: newShipType.value,
      player: newShipPlayer.value,
    })
    syncCellControlWithShips(cell)
    syncSymmetryOrbitFor(cell.q, cell.r)
  }
}

function removeShip(index: number) {
  if (!selectedCell.value?.startingShips) return
  pushHistory()
  selectedCell.value.startingShips.splice(index, 1)
  if (!selectedCell.value.startingShips.length) {
    delete selectedCell.value.startingShips
  } else {
    syncCellControlWithShips(selectedCell.value)
  }
  syncSymmetryOrbit()
}

function copySelectedCell() {
  const cells = selectedCellsList()
  if (!cells.length) return
  const anchor = cells[0]!
  cellClipboard.value = {
    anchor: { q: anchor.q, r: anchor.r },
    entries: cells.map((c) => ({
      dq: c.q - anchor.q,
      dr: c.r - anchor.r,
      content: extractCellContent(c),
    })),
  }
}

function pasteToSelectedCell() {
  if (!selectedKey.value || !cellClipboard.value) return
  const anchor = parseHexKey(selectedKey.value)
  pushHistory()
  const pastedKeys: string[] = []
  for (const entry of cellClipboard.value.entries) {
    const q = anchor.q + entry.dq
    const r = anchor.r + entry.dr
    let idx = map.value.cells.findIndex((c) => c.q === q && c.r === r)
    if (idx < 0) {
      map.value.cells.push({ q, r })
      idx = map.value.cells.length - 1
    }
    if (idx < 0) continue
    const cell = { q, r }
    applyCellContent(cell, entry.content)
    map.value.cells.splice(idx, 1, cell)
    syncSymmetryOrbitFor(q, r)
    pastedKeys.push(hexKey(q, r))
  }
  if (pastedKeys.length) selectedKeys.value = pastedKeys
}

function cutSelectedCell() {
  copySelectedCell()
  removeSelected()
}

function saveLocal() {
  const normalized = normalizeMapDefinition(map.value)
  map.value = normalized
  const save = galaxySaveFromMap(normalized)
  const list = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown[]
  const parsed = list.map((entry) => {
    try {
      return parseGalaxySave(entry)
    } catch {
      return galaxySaveFromMap(normalizeMapDefinition(entry as MapDefinition))
    }
  })
  const idx = parsed.findIndex((s) => s.map.id === save.map.id)
  if (idx >= 0) parsed[idx] = save
  else parsed.push(save)
  localStorage.setItem(storageKey, JSON.stringify(parsed))
  refreshSavedMaps()
  persistEditorDraftNow()
}

function loadSelectedMap() {
  const raw = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown[]
  const found = raw
    .map((entry) => {
      try {
        return parseGalaxySave(entry)
      } catch {
        return null
      }
    })
    .find((s) => s?.map.id === loadMapId.value)
  if (!found) return
  loadSaveToEditor(found)
}

function newMap() {
  map.value = normalizeMapDefinition(createEmptyMap(`map-${Date.now()}`, 'Новая карта'))
  selectedKey.value = hexKey(0, 0)
  resetHistory()
}

function clearMap() {
  if (!confirm('Очистить карту? Останется одна пустая клетка (0,0), id и название сохранятся.')) return
  pushHistory()
  const { id, name } = map.value
  map.value = normalizeMapDefinition(createEmptyMap(id, name))
  selectedKey.value = hexKey(0, 0)
}

function exportJson() {
  const save = galaxySaveFromMap(normalizeMapDefinition(map.value))
  const blob = new Blob([serializeGalaxySave(save)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = galaxySaveDownloadFileName(map.value.name, map.value.id)
  a.click()
  URL.revokeObjectURL(url)
}

async function submitForModeration() {
  moderationMessage.value = null
  const name = nickname.value.trim()
  if (!name) {
    moderationMessage.value = 'Укажите никнейм на главной странице'
    return
  }
  const errors = validateMapDefinition(normalizeMapDefinition(map.value))
  if (errors.length) {
    moderationMessage.value = errors[0] ?? 'Карта не прошла проверку'
    return
  }
  try {
    const save = galaxySaveFromMap(normalizeMapDefinition(map.value))
    await submitMapForModeration(name, save)
    moderationMessage.value = 'Заявка отправлена на модерацию'
  } catch (e) {
    moderationMessage.value = e instanceof Error ? e.message : 'Не удалось отправить'
  }
}

function importJson(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const save = parseGalaxySave(JSON.parse(String(reader.result)))
      loadSaveToEditor(save)
      if (save.game) upsertLobbySave(save)
    } catch {
      alert('Не удалось прочитать JSON')
    }
  }
  reader.readAsText(file)
  input.value = ''
}

useMapEditorHotkeys({
  map,
  selectedKey,
  selectedCount,
  ghosts,
  shipsFull,
  hasCellClipboard,
  selectCell,
  selectAllCells,
  addCell,
  removeSelected,
  togglePowerCenter,
  setStartPlayer,
  addShip,
  saveLocal,
  copySelectedCell,
  pasteToSelectedCell,
  cutSelectedCell,
  undo,
  redo,
  canUndo,
})
</script>

<template>
  <div class="editor-viewport">
    <section
      ref="boardFocusRef"
      class="board-layer"
      tabindex="-1"
      aria-label="Карта — кликните для горячих клавиш"
      @mousedown="focusBoard"
    >
      <GameBoard
        :cells="boardCells"
        :ghosts="ghosts"
        :selected-key="selectedKey"
        :selected-keys="selectedKeys"
        :symmetry-orbit-keys="symmetryOrbitKeys"
        :orientation="boardOrientation"
        mode="editor"
        @select="selectCell"
        @add-ghost="addCell"
        @update:orientation="setBoardOrientation"
      />
    </section>

    <footer
      class="hotkeys-bar"
      :class="{ 'hotkeys-bar--collapsed': !hotkeysOpen }"
      aria-label="Горячие клавиши"
    >
      <button
        type="button"
        class="hotkeys-bar-title"
        :aria-expanded="hotkeysOpen"
        aria-controls="editor-hotkeys-list"
        @click="hotkeysOpen = !hotkeysOpen"
      >
        <span class="hotkeys-bar-caret" aria-hidden="true">{{ hotkeysOpen ? '▾' : '▸' }}</span>
        {{ editorUi.hotkeysBarTitle }}
      </button>
      <div v-show="hotkeysOpen" id="editor-hotkeys-list" class="hotkeys-bar-list">
        <span
          v-for="row in MAP_EDITOR_HOTKEYS"
          :key="row.keys"
          class="hotkeys-bar-item"
        >
          <kbd>{{ row.keys }}</kbd>
          <span>{{ row.action }}</span>
        </span>
      </div>
    </footer>

    <header class="hud-top">
      <NuxtLink to="/" class="back-link">← На главную</NuxtLink>
      <label class="inline-field name-field">
        <input v-model="map.name" type="text" placeholder="Название карты" />
      </label>
      <label class="inline-field id-field">
        <input v-model="map.id" type="text" placeholder="id" />
      </label>
      <p v-if="errors.length" class="err hud-err" :title="errors.join(' · ')">{{ errors[0] }}</p>
      <p
        v-else-if="balanceWarnings.length"
        class="hud-err hud-warn"
        :title="balanceWarnings.join(' · ')"
      >
        {{ balanceWarnings[0] }}<template v-if="balanceWarnings.length > 1"> (ещё {{ balanceWarnings.length - 1 }})</template>
      </p>
    </header>

    <aside class="hud-right" :class="{ collapsed: panelCollapsed }">
      <button type="button" class="panel-toggle" @click="panelCollapsed = !panelCollapsed">
        {{ panelCollapsed ? '«' : '»' }}
      </button>
      <div v-if="!panelCollapsed" class="panel-inner">
        <nav class="panel-tabs">
          <button type="button" :class="{ active: panelTab === 'cell' }" @click="panelTab = 'cell'">Клетка</button>
          <button type="button" :class="{ active: panelTab === 'symmetry' }" @click="panelTab = 'symmetry'">Симметрия</button>
          <button type="button" :class="{ active: panelTab === 'file' }" @click="panelTab = 'file'">Файл</button>
          <button type="button" :class="{ active: panelTab === 'help' }" @click="panelTab = 'help'">?</button>
        </nav>

        <div v-show="panelTab === 'cell'" class="panel-body">
          <template v-if="selectedCell">
            <h2>
              <template v-if="selectedCount > 1">{{ editorUi.multiSelected(selectedCount) }}</template>
              <template v-else>({{ selectedKey }})</template>
              <span v-if="hasCellClipboard" class="clipboard-badge" title="Ctrl+V">буфер</span>
            </h2>

          <section class="block">
            <h3>Токен</h3>
            <div class="radio-row compact">
              <label><input v-model="tokenKind" type="radio" value="none" /> Нет</label>
              <label><input v-model="tokenKind" type="radio" value="credits" /> Кредиты</label>
              <label><input v-model="tokenKind" type="radio" value="production" /> Производство</label>
            </div>
            <div v-if="tokenKind !== 'none'" class="value-row">
              <input v-model.number="tokenValue" type="range" min="1" max="9" step="1" />
              <label class="token-number">
                <span class="sr-only">{{ editorUi.tokenValue }}</span>
                <input
                  v-model.number="tokenValue"
                  type="number"
                  min="1"
                  max="9"
                  step="1"
                  inputmode="numeric"
                />
              </label>
              <svg v-if="tokenPreview" viewBox="-16 -16 32 32" class="token-preview" aria-hidden="true">
                <ResourceTokenGlyph :token="tokenPreview" />
              </svg>
            </div>
          </section>

          <section class="block">
            <h3>Контроль</h3>
            <div class="player-grid">
              <button
                type="button"
                class="player-btn neutral"
                :class="{ active: selectedCell.startPlayer == null }"
                @click="setStartPlayer(null)"
              >
                —
              </button>
              <button
                v-for="slot in playerSlots"
                :key="slot"
                type="button"
                class="player-btn"
                :class="{ active: selectedCell.startPlayer === slot }"
                :style="{ '--swatch': PLAYER_COLORS[slot] }"
                @click="setStartPlayer(slot)"
              >
                {{ slot }}. {{ PLAYER_LABELS[slot] }}
              </button>
            </div>
          </section>

          <section class="block">
            <h3>
              Корабли {{ shipCount }}/{{ MAX_SHIPS_PER_CELL }}
              <span class="sub">· игрок {{ playerShipCount }}/{{ MAX_SHIPS_PER_CELL_PER_PLAYER }}</span>
            </h3>
            <div class="ship-picker">
              <button
                v-for="t in SHIP_TYPES"
                :key="t"
                type="button"
                class="ship-pick"
                :class="{ active: newShipType === t }"
                :title="SHIP_LABELS[t]"
                @click="newShipType = t"
              >
                <svg viewBox="-14 -14 28 28" class="ship-pick-icon" aria-hidden="true">
                  <ShipGlyph
                    :type="t"
                    :player-color="PLAYER_COLORS[newShipPlayer]"
                    :scale="0.75"
                  />
                </svg>
                <span>{{ SHIP_LABELS[t] }}</span>
              </button>
            </div>
            <div class="ship-add">
              <span class="ship-add-label">Игрок:</span>
              <select v-model.number="newShipPlayer">
                <option v-for="slot in playerSlots" :key="slot" :value="slot">
                  {{ PLAYER_LABELS[slot] }}
                </option>
              </select>
              <button type="button" :disabled="shipsFull" @click="addShip">+</button>
            </div>
            <ul v-if="selectedCell.startingShips?.length" class="ship-list">
              <li v-for="(ship, idx) in selectedCell.startingShips" :key="idx">
                <svg viewBox="-14 -14 28 28" class="ship-list-icon" aria-hidden="true">
                  <ShipGlyph
                    :type="ship.type"
                    :player-color="PLAYER_COLORS[ship.player]"
                    :scale="0.8"
                  />
                </svg>
                <span class="ship-chip">
                  {{ SHIP_LABELS[ship.type] }} · {{ PLAYER_LABELS[ship.player] }}
                </span>
                <button type="button" class="icon-btn" title="Удалить" @click="removeShip(idx)">×</button>
              </li>
            </ul>
          </section>

          <section class="block actions">
            <label class="toggle">
              <input
                type="checkbox"
                :checked="!!selectedCell.isPowerCenter"
                @change="togglePowerCenter"
              />
              Центр власти
            </label>
            <button type="button" class="danger" title="Del" @click="removeSelected">Удалить</button>
          </section>
          </template>
          <p v-else class="hint">Выберите клетку на карте.</p>
        </div>

        <div v-show="panelTab === 'symmetry'" class="panel-body">
        <section class="block symmetry">
          <h3>Симметрия</h3>
          <label class="toggle">
            <input
              type="checkbox"
              :checked="symmetry.enabled"
              @change="onSymmetryEnabledChange(($event.target as HTMLInputElement).checked)"
            />
            Режим симметрии
          </label>
          <template v-if="symmetry.enabled">
            <div class="symmetry-players">
              <button
                v-for="opt in SYMMETRY_PLAYER_OPTIONS"
                :key="opt.count"
                type="button"
                class="symmetry-btn"
                :class="{ active: symmetry.playerCount === opt.count }"
                @click="symmetry.playerCount = opt.count"
              >
                {{ opt.label }}
              </button>
            </div>
            <p class="hint">{{ symmetryHint }}</p>
            <template v-if="showSymmetryAxisControls">
              <div class="radio-row">
                <label>
                  <input v-model="symmetry.axisKind" type="radio" value="line" />
                  Ось через центры гексов
                </label>
                <label>
                  <input v-model="symmetry.axisKind" type="radio" value="edge" />
                  Ось через границы
                </label>
              </div>
              <div class="axis-row">
                <button
                  v-for="(label, idx) in symmetryAxisLabels"
                  :key="label"
                  type="button"
                  class="symmetry-btn"
                  :class="{ active: symmetry.axisIndex === idx }"
                  @click="symmetry.axisIndex = idx"
                >
                  {{ label }}
                </button>
              </div>
              <p v-if="horizontalThroughCentersHint" class="hint warn">{{ horizontalThroughCentersHint }}</p>
              <button
                v-if="horizontalThroughCentersHint"
                type="button"
                class="symmetry-expand"
                @click="setBoardOrientation('pointy')"
              >
                Показать карту углом вверх
              </button>
            </template>
            <button type="button" class="symmetry-expand" @click="expandSymmetryStructure">
              Досоздать недостающие клетки
            </button>
            <p class="hint">Кисть уже зеркалит новые клетки. «Досоздать» добавляет недостающие копии уже нарисованных клеток.</p>
          </template>
        </section>
        </div>

        <div v-show="panelTab === 'file'" class="panel-body">
        <section class="block io">
          <h3>Карта</h3>
          <label class="inline-field player-count-field">
            Игроков на карте
            <select v-model.number="mapPlayerCount">
              <option v-for="n in MAX_LOBBY_PLAYERS" :key="n" :value="n">{{ n }}</option>
            </select>
          </label>
          <p class="hint">Независимо от режима симметрии. По умолчанию — по стартовым позициям или 2.</p>
          <div class="io-row">
            <button type="button" @click="newMap">Новая</button>
            <button type="button" class="danger" @click="clearMap">Очистить</button>
            <button type="button" @click="saveLocal">Сохранить</button>
            <button type="button" @click="exportJson">Экспорт</button>
            <button type="button" @click="submitForModeration">На модерацию</button>
            <label class="file-btn">
              Импорт
              <input type="file" accept="application/json,.json,.galaxy.json" hidden @change="importJson" />
            </label>
          </div>
          <p v-if="moderationMessage" class="hint">{{ moderationMessage }}</p>
          <div v-if="savedMaps.length" class="load-row">
            <select v-model="loadMapId">
              <option value="" disabled>Загрузить из браузера…</option>
              <option v-for="m in savedMaps" :key="m.id" :value="m.id">{{ m.name }} ({{ m.id }})</option>
            </select>
            <button type="button" :disabled="!loadMapId" @click="loadSelectedMap">Загрузить</button>
          </div>
          <button type="button" class="ascii-toggle" @click="showAscii = !showAscii">
            ASCII
          </button>
          <pre v-if="showAscii" class="ascii">{{ asciiPreview }}</pre>
        </section>
        </div>

        <div v-show="panelTab === 'help'" class="panel-body">
        <section class="block hotkeys">
          <h3>Горячие клавиши</h3>
          <dl class="hotkey-list">
            <template v-for="row in MAP_EDITOR_HOTKEYS" :key="row.keys">
              <dt>{{ row.keys }}</dt>
              <dd>{{ row.action }}</dd>
            </template>
          </dl>
        </section>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.editor-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: #e2e8f0;
  overflow: hidden;
}
.board-layer {
  position: absolute;
  inset: 0;
  bottom: 2.4rem;
  outline: none;
  overflow: hidden;
}
.hud-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: nowrap;
  padding: 0.4rem 0.6rem;
  background: linear-gradient(to bottom, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.4), transparent);
  backdrop-filter: blur(4px);
  pointer-events: none;
}
.hud-top > * {
  pointer-events: auto;
}
.back-link {
  color: #93c5fd;
  text-decoration: none;
  font-size: 0.8rem;
  flex-shrink: 0;
}
.inline-field {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.inline-field input {
  padding: 0.28rem 0.45rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: rgba(30, 41, 59, 0.9);
  color: #f8fafc;
  font-size: 0.8rem;
}
.name-field input {
  min-width: 160px;
}
.id-field input {
  width: 88px;
}
.hud-warn {
  color: #fcd34d;
}
.hud-err {
  font-size: 0.75rem;
  max-width: 180px;
  margin-left: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hud-right {
  position: absolute;
  top: 2.75rem;
  right: 0;
  bottom: 0;
  width: 320px;
  z-index: 25;
  display: flex;
  background: rgba(30, 41, 59, 0.92);
  border-left: 1px solid rgba(71, 85, 105, 0.8);
  backdrop-filter: blur(8px);
  transition: width 0.2s ease;
}
.hud-right.collapsed {
  width: 2rem;
}
.panel-toggle {
  width: 2rem;
  flex-shrink: 0;
  border: none;
  border-right: 1px solid #334155;
  background: rgba(15, 23, 42, 0.8);
  color: #cbd5e1;
  cursor: pointer;
  font-size: 1rem;
}
.panel-inner {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.panel-tabs {
  display: flex;
  border-bottom: 1px solid #334155;
}
.panel-tabs button {
  flex: 1;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0.4rem 0.25rem;
  font-size: 0.74rem;
  color: #94a3b8;
}
.panel-tabs button.active {
  background: rgba(51, 65, 85, 0.6);
  color: #f8fafc;
  box-shadow: inset 0 -2px #fbbf24;
}
.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.55rem 0.65rem;
}
.panel-body h2 {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.clipboard-badge {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  background: #14532d;
  color: #bbf7d0;
}
.block {
  margin-bottom: 0.65rem;
  padding-bottom: 0.65rem;
  border-bottom: 1px solid #334155;
}
.block:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}
.block h3 {
  margin: 0 0 0.3rem;
  font-size: 0.82rem;
  color: #cbd5e1;
}
.block h3 .sub {
  font-weight: normal;
  color: #64748b;
  font-size: 0.75rem;
}
.hint {
  margin: 0 0 0.35rem;
  font-size: 0.75rem;
  color: #64748b;
}
.hint.warn {
  color: #fbbf24;
}
.radio-row.compact {
  font-size: 0.82rem;
  gap: 0.25rem;
}
.board-layer:focus-visible {
  box-shadow: inset 0 0 0 2px #fbbf24;
}
.radio-row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.9rem;
}
.value-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.5rem;
}
.value-row input[type='range'] {
  flex: 1;
}
.token-number input {
  width: 3.2rem;
  padding: 0.25rem 0.35rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #0f172a;
  color: #f8fafc;
  font-size: 0.9rem;
  text-align: center;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.token-preview {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}
.player-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
}
.player-btn {
  padding: 0.3rem 0.4rem;
  border-radius: 6px;
  border: 2px solid #475569;
  background: #0f172a;
  color: #e2e8f0;
  cursor: pointer;
  font-size: 0.72rem;
  text-align: left;
}
.player-btn::before {
  content: '';
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
  background: var(--swatch, #64748b);
}
.player-btn.neutral::before {
  background: #c8c4b8;
}
.player-btn.active {
  border-color: #fbbf24;
}
.ship-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.ship-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}
.ship-list-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}
.ship-chip {
  font-size: 0.85rem;
  padding: 0.2rem 0.5rem;
  background: #0f172a;
  border-radius: 4px;
  flex: 1;
}
.ship-picker {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
  margin-bottom: 0.5rem;
}
.ship-pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  padding: 0.35rem 0.2rem;
  border-radius: 8px;
  border: 2px solid #475569;
  background: #0f172a;
  color: #cbd5e1;
  cursor: pointer;
  font-size: 0.6rem;
  line-height: 1.1;
  text-align: center;
}
.ship-pick.active {
  border-color: #fbbf24;
  background: #172554;
}
.ship-pick-icon {
  width: 36px;
  height: 36px;
}
.ship-add {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 0.75rem;
}
.ship-add-label {
  font-size: 0.85rem;
  color: #94a3b8;
}
.ship-add select {
  flex: 1;
  min-width: 100px;
  padding: 0.35rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #0f172a;
  color: #f8fafc;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}
.symmetry-players,
.axis-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.5rem;
}
.symmetry-btn {
  flex: 1;
  min-width: 5.5rem;
  font-size: 0.78rem;
  padding: 0.35rem 0.5rem;
}
.symmetry-btn.active {
  border-color: #38bdf8;
  background: #0c4a6e;
}
.symmetry-expand {
  width: 100%;
  font-size: 0.82rem;
}
button {
  padding: 0.35rem 0.55rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #334155;
  color: #f8fafc;
  cursor: pointer;
  font-size: 0.78rem;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button.danger {
  background: #7f1d1d;
  border-color: #991b1b;
}
.icon-btn {
  padding: 0.1rem 0.45rem;
  font-size: 1.1rem;
  line-height: 1;
}
.io-row,
.load-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.load-row select {
  flex: 1;
  min-width: 160px;
  padding: 0.35rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #0f172a;
  color: #f8fafc;
}
.file-btn {
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.55rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #334155;
  cursor: pointer;
  font-size: 0.78rem;
}
.hotkeys h3 {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
}
.hotkey-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.25rem 0.75rem;
  margin: 0;
  font-size: 0.78rem;
}
.hotkey-list dt {
  margin: 0;
  color: #cbd5e1;
  font-family: ui-monospace, monospace;
  white-space: nowrap;
}
.hotkey-list dd {
  margin: 0;
  color: #94a3b8;
}
.ascii-toggle {
  width: 100%;
  margin-bottom: 0.5rem;
}
.ascii {
  font-size: 0.65rem;
  background: #0f172a;
  padding: 0.5rem;
  overflow: auto;
  max-height: 180px;
  border-radius: 6px;
  margin: 0;
}
.err {
  color: #f87171;
}
.hotkeys-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 25;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--g-s-2) var(--g-s-4);
  padding: var(--g-s-2) var(--g-s-3);
  background: linear-gradient(to top, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.72));
  border-top: 1px solid var(--g-border);
  pointer-events: none;
  font-size: var(--g-text-xs);
  color: var(--g-text-dim);
}
/* Свёрнутая полоса не отъедает две строки у карты */
.hotkeys-bar--collapsed {
  background: none;
  border-top: none;
}
.hotkeys-bar-title {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  pointer-events: auto;
  padding: 0.15rem var(--g-s-2);
  border: 1px solid var(--g-border);
  border-radius: var(--g-r-pill);
  background: var(--g-surface-glass);
  color: var(--g-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.hotkeys-bar-title:hover {
  border-color: var(--g-border-strong);
}
.hotkeys-bar-caret {
  color: var(--g-text-mute);
}
.hotkeys-bar-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2) var(--g-s-4);
  min-width: 0;
}
.hotkeys-bar-item {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  white-space: nowrap;
}
.hotkeys-bar kbd {
  padding: 0.1rem 0.35rem;
  border-radius: var(--g-r-sm);
  border: 1px solid var(--g-border-strong);
  background: var(--g-surface-0);
  color: var(--g-text);
  font-family: ui-monospace, monospace;
  font-size: 0.68rem;
}
</style>
