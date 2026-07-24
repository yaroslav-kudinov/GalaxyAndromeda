<script setup lang="ts">
import type { MapCellDefinition } from '@galaxy/rules'
import { hexKey } from '@galaxy/rules'

const props = defineProps<{
  cells: MapCellDefinition[]
  ghosts: { q: number; r: number }[]
  selectedKey: string | null
}>()

const emit = defineEmits<{
  select: [q: number, r: number]
  addGhost: [q: number, r: number]
}>()

const size = 36

function hexPoints(q: number, r: number): string {
  const x = size * (3 / 2) * q
  const y = size * Math.sqrt(3) * (r + q / 2)
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i)
    pts.push(`${x + size * Math.cos(angle)},${y + size * Math.sin(angle)}`)
  }
  return pts.join(' ')
}

const viewBox = computed(() => {
  const all = [...props.cells, ...props.ghosts]
  if (!all.length) return '0 0 100 100'
  const xs = all.map((c) => size * (3 / 2) * c.q)
  const ys = all.map((c) => size * Math.sqrt(3) * (c.r + c.q / 2))
  const pad = size * 2
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  const maxX = Math.max(...xs) + pad
  const maxY = Math.max(...ys) + pad
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`
})
</script>

<template>
  <svg :viewBox="viewBox" class="hex-board" xmlns="http://www.w3.org/2000/svg">
    <g v-for="g in ghosts" :key="'g' + hexKey(g.q, g.r)">
      <polygon
        :points="hexPoints(g.q, g.r)"
        class="ghost"
        @click="emit('addGhost', g.q, g.r)"
      />
      <text
        :x="size * (3 / 2) * g.q"
        :y="size * Math.sqrt(3) * (g.r + g.q / 2)"
        class="ghost-label"
      >+</text>
    </g>
    <g v-for="cell in cells" :key="hexKey(cell.q, cell.r)">
      <polygon
        :points="hexPoints(cell.q, cell.r)"
        :class="{ hex: true, selected: selectedKey === hexKey(cell.q, cell.r) }"
        @click="emit('select', cell.q, cell.r)"
      />
      <text
        :x="size * (3 / 2) * cell.q"
        :y="size * Math.sqrt(3) * (cell.r + cell.q / 2) + 4"
        class="label"
      >
        {{ cell.q }},{{ cell.r }}{{ cell.isPowerCenter ? ' ★' : '' }}
      </text>
    </g>
  </svg>
</template>

<style scoped>
.hex-board {
  width: 100%;
  max-width: 640px;
  height: 480px;
  background: #0f172a;
  border-radius: 8px;
}
.hex {
  fill: #c8c4b8;
  stroke: #666;
  stroke-width: 1;
  cursor: pointer;
}
.hex.selected {
  stroke: #3b82f6;
  stroke-width: 3;
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
  pointer-events: none;
}
.label {
  fill: #111;
  font-size: 10px;
  text-anchor: middle;
  pointer-events: none;
}
</style>
