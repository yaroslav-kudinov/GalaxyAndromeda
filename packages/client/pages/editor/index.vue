<script setup lang="ts">
import type { MapCellDefinition, MapDefinition, ResourceTokenDef } from '@galaxy/rules'
import { createEmptyMap, getGhostSlots, hexKey, validateMapDefinition } from '@galaxy/rules'
import { renderAsciiMapFromDefinition } from '@galaxy/rules'

const map = ref<MapDefinition>(createEmptyMap('draft', 'Draft'))
const selectedKey = ref<string | null>(hexKey(0, 0))
const storageKey = 'galaxy-maps'

const cellMap = computed(() => new Map(map.value.cells.map((c) => [hexKey(c.q, c.r), c])))
const ghosts = computed(() => getGhostSlots(map.value))
const asciiPreview = computed(() => renderAsciiMapFromDefinition(map.value))
const errors = computed(() => validateMapDefinition(map.value))

function selectCell(q: number, r: number) {
  selectedKey.value = hexKey(q, r)
}

function addCell(q: number, r: number) {
  if (cellMap.value.has(hexKey(q, r))) return
  map.value.cells.push({ q, r })
  selectedKey.value = hexKey(q, r)
}

function removeSelected() {
  if (!selectedKey.value || map.value.cells.length <= 1) return
  map.value.cells = map.value.cells.filter((c) => hexKey(c.q, c.r) !== selectedKey.value)
  selectedKey.value = hexKey(map.value.cells[0].q, map.value.cells[0].r)
}

const selectedCell = computed(() =>
  selectedKey.value ? cellMap.value.get(selectedKey.value) : undefined,
)

function togglePowerCenter() {
  if (!selectedCell.value) return
  selectedCell.value.isPowerCenter = !selectedCell.value.isPowerCenter
}

function addToken(type: ResourceTokenDef['type'], value: ResourceTokenDef['value']) {
  if (!selectedCell.value) return
  if (!selectedCell.value.resourceTokens) selectedCell.value.resourceTokens = []
  selectedCell.value.resourceTokens.push({ type, value, faceUp: true })
}

function saveLocal() {
  const list = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as MapDefinition[]
  const idx = list.findIndex((m) => m.id === map.value.id)
  if (idx >= 0) list[idx] = map.value
  else list.push(map.value)
  localStorage.setItem(storageKey, JSON.stringify(list))
  alert('Saved to localStorage')
}

function exportJson() {
  const blob = new Blob([JSON.stringify(map.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${map.value.id}.json`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="editor">
    <h1>Творческий режим — редактор карт</h1>
    <div class="layout">
      <HexBoard
        :cells="map.cells"
        :ghosts="ghosts"
        :selected-key="selectedKey"
        @select="selectCell"
        @add-ghost="addCell"
      />
      <aside class="panel">
        <h2>Свойства клетки</h2>
        <p v-if="selectedKey">Выбрано: {{ selectedKey }}</p>
        <button type="button" @click="removeSelected">Удалить клетку</button>
        <button type="button" @click="togglePowerCenter">Toggle Центр Власти ★</button>
        <div class="tokens">
          <button type="button" @click="addToken('credits', 3)">+ Кредиты (3)</button>
          <button type="button" @click="addToken('production', 2)">+ Производство (2)</button>
        </div>
        <h3>ASCII preview</h3>
        <pre class="ascii">{{ asciiPreview }}</pre>
        <div class="io">
          <button type="button" @click="saveLocal">Сохранить</button>
          <button type="button" @click="exportJson">Export JSON</button>
        </div>
        <p v-if="errors.length" class="err">{{ errors.join('; ') }}</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.panel {
  min-width: 280px;
  padding: 1rem;
  border: 1px solid #444;
  border-radius: 8px;
}
.panel button {
  display: block;
  margin: 0.25rem 0;
  padding: 0.4rem 0.8rem;
  cursor: pointer;
}
.ascii {
  font-size: 0.7rem;
  background: #111;
  padding: 0.5rem;
  overflow: auto;
  max-height: 200px;
}
.err {
  color: #f87171;
}
</style>
