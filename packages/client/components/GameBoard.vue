<script setup lang="ts">
import type { BoardCellView } from '~/utils/board-adapter'
import { boardMarkerKeys } from '~/utils/board-adapter'
import type { HexOrientation } from '~/utils/hex-layout'
import type { TerritoryLabelPlayer } from '~/composables/usePlayerTerritoryLabels'

const props = withDefaults(
  defineProps<{
    cells: BoardCellView[]
    ghosts?: { q: number; r: number }[]
    selectedKey?: string | null
    symmetryOrbitKeys?: string[]
    reachableKeys?: string[]
    destinationKeys?: string[]
    contestedKeys?: string[]
    supplyChainKeys?: string[]
    myTerritoryKeys?: string[]
    movementSourceKey?: string | null
    previewMoves?: { from: { q: number; r: number }; to: { q: number; r: number }; combat?: boolean }[]
    territoryLabelPlayers?: TerritoryLabelPlayer[]
    availableActionMarkerKeys?: string[]
    availableProductionMarkerKeys?: string[]
    mode?: 'editor' | 'game'
    zoomable?: boolean
    showOrientationToggle?: boolean
    showAutoFitToggle?: boolean
    orientation?: HexOrientation
  }>(),
  {
    ghosts: () => [],
    selectedKey: null,
    symmetryOrbitKeys: () => [],
    reachableKeys: () => [],
    destinationKeys: () => [],
    contestedKeys: () => [],
    supplyChainKeys: () => [],
    myTerritoryKeys: () => [],
    movementSourceKey: null,
    previewMoves: () => [],
    territoryLabelPlayers: () => [],
    availableActionMarkerKeys: () => [],
    availableProductionMarkerKeys: () => [],
    mode: 'editor',
    zoomable: true,
    showOrientationToggle: true,
    showAutoFitToggle: true,
  },
)

const emit = defineEmits<{
  select: [q: number, r: number]
  addGhost: [q: number, r: number]
}>()

const markerKeys = computed(() => boardMarkerKeys(props.cells))
</script>

<template>
  <HexBoard
    :cells="cells"
    :ghosts="ghosts"
    :selected-key="selectedKey"
    :symmetry-orbit-keys="symmetryOrbitKeys"
    :action-marker-keys="markerKeys.action"
    :production-marker-keys="markerKeys.production"
    :reachable-keys="reachableKeys"
    :destination-keys="destinationKeys"
    :contested-keys="contestedKeys"
    :supply-chain-keys="supplyChainKeys"
    :my-territory-keys="myTerritoryKeys"
    :movement-source-key="movementSourceKey"
    :preview-moves="previewMoves"
    :territory-label-players="territoryLabelPlayers"
    :available-action-marker-keys="availableActionMarkerKeys"
    :available-production-marker-keys="availableProductionMarkerKeys"
    :mode="mode"
    toolbar-placement="overlay"
    fill-viewport
    :zoomable="zoomable"
    :show-orientation-toggle="showOrientationToggle"
    :show-auto-fit-toggle="showAutoFitToggle"
    :orientation="orientation"
    @select="(q, r) => emit('select', q, r)"
    @add-ghost="(q, r) => emit('addGhost', q, r)"
  />
</template>
