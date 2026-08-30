<script setup lang="ts">
import type { GameSnapshot, PlayerState, ShipType } from '@galaxy/rules'
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
    availableActionMarkerKeys?: string[]
    interactiveKeys?: string[]
    mode?: 'editor' | 'game'
    zoomable?: boolean
    showOrientationToggle?: boolean
    showAutoFitToggle?: boolean
    autoFitOnMapChange?: boolean
    orientation?: HexOrientation
    players?: PlayerState[]
    translucentCells?: boolean
    combatPulseKeys?: string[]
    incomingShipIds?: string[]
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
    ghosts: () => [],
    selectedKey: null,
    symmetryOrbitKeys: () => [],
    reachableKeys: () => [],
    destinationKeys: () => [],
    contestedKeys: () => [],
    supplyChainKeys: () => [],
    myTerritoryKeys: () => [],
    hideTerritoryPlayers: () => [],
    movementSourceKey: null,
    previewMoves: () => [],
    previewPlacements: () => [],
    previewPlacementsPulse: false,
    territoryLabelPlayers: () => [],
    availableActionMarkerKeys: () => [],
    interactiveKeys: () => [],
    mode: 'editor',
    zoomable: true,
    showOrientationToggle: true,
    showAutoFitToggle: true,
    players: () => [],
    translucentCells: false,
    combatPulseKeys: () => [],
    incomingShipIds: () => [],
    activeShipIds: () => [],
    combatGhosts: () => [],
    observationRevision: 0,
    snapshot: null,
    mapId: null,
  },
)

const emit = defineEmits<{
  select: [q: number, r: number]
  addGhost: [q: number, r: number]
  'update:orientation': [orientation: HexOrientation]
}>()

const markerKeys = computed(() => boardMarkerKeys(props.cells))
</script>

<template>
  <HexBoard
    :cells="cells"
    :ghosts="ghosts"
    :selected-key="selectedKey"
    :symmetry-orbit-keys="symmetryOrbitKeys"
    :action-marker-keys="markerKeys"
    :reachable-keys="reachableKeys"
    :destination-keys="destinationKeys"
    :contested-keys="contestedKeys"
    :supply-chain-keys="supplyChainKeys"
    :my-territory-keys="myTerritoryKeys"
    :hide-territory-players="hideTerritoryPlayers"
    :movement-source-key="movementSourceKey"
    :preview-moves="previewMoves"
    :preview-placements="previewPlacements"
    :preview-placements-pulse="previewPlacementsPulse"
    :territory-label-players="territoryLabelPlayers"
    :available-action-marker-keys="availableActionMarkerKeys"
    :interactive-keys="interactiveKeys"
    :mode="mode"
    toolbar-placement="overlay"
    fill-viewport
    :zoomable="zoomable"
    :show-orientation-toggle="showOrientationToggle"
    :show-auto-fit-toggle="showAutoFitToggle"
    :auto-fit-on-map-change="autoFitOnMapChange"
    :orientation="orientation"
    :players="players"
    :translucent-cells="translucentCells"
    :combat-pulse-keys="combatPulseKeys"
    :incoming-ship-ids="incomingShipIds"
    :active-ship-ids="activeShipIds"
    :combat-ghosts="combatGhosts"
    :observation-revision="observationRevision"
    :snapshot="snapshot"
    :map-id="mapId"
    @select="(q, r) => emit('select', q, r)"
    @add-ghost="(q, r) => emit('addGhost', q, r)"
    @update:orientation="(value) => emit('update:orientation', value)"
  />
</template>
