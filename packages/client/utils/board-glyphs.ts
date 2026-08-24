import { STRATEGIC_ZOOM_THRESHOLD } from '~/utils/board-overview'
import { TOKEN_CHIP_RADIUS } from '~/utils/resource-token-pips'

/** Compensate SVG glyph scale when viewBox zoom changes (screen-stable icon size) */
export function effectiveGlyphScale(baseScale: number, zoom: number, mode: 'editor' | 'game' = 'editor'): number {
  const clampedZoom = Math.min(3, Math.max(0.35, zoom))
  const min = mode === 'game' ? 0.38 : 0.4
  const max = mode === 'game' ? 0.88 : 0.92
  return Math.min(max, Math.max(min, baseScale / clampedZoom))
}

/** Boost compact overlay icons when the map is zoomed out */
export function overlayContentScale(zoom: number): number {
  if (zoom > STRATEGIC_ZOOM_THRESHOLD) return 1
  const clamped = Math.min(STRATEGIC_ZOOM_THRESHOLD, Math.max(0.35, zoom))
  return Math.min(1.45, STRATEGIC_ZOOM_THRESHOLD / clamped)
}

export const TOKEN_BOARD_SCALE = 0.95
export const POWER_CENTER_BOARD_SCALE_REF = 0.56

/** Kept for editor paths that still use token/crown glyphs elsewhere */
export function tokenBoardScale(zoom: number, mode: 'editor' | 'game' = 'editor'): number {
  return effectiveGlyphScale(TOKEN_BOARD_SCALE, zoom, mode)
}

export function powerCenterBoardScale(zoom: number, mode: 'editor' | 'game' = 'editor'): number {
  return effectiveGlyphScale(POWER_CENTER_BOARD_SCALE_REF, zoom, mode)
}

/** Компактный жетон относительно гекса (как на крупном масштабе). */
export function resourceTokenGlyphScale(hexSize: number): number {
  return (hexSize * 0.572) / (2 * TOKEN_CHIP_RADIUS)
}
