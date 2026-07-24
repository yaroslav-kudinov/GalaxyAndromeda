export type HexOrientation = 'flat' | 'pointy'

export const HEX_ORIENTATIONS: { id: HexOrientation; label: string; title: string }[] = [
  { id: 'flat', label: 'Грань', title: 'Ориентация: гранью вверх' },
  { id: 'pointy', label: 'Угол', title: 'Ориентация: углом вверх' },
]

/** Pixel center for axial (q, r) */
export function hexCenter(
  q: number,
  r: number,
  size: number,
  orientation: HexOrientation,
): { x: number; y: number } {
  if (orientation === 'pointy') {
    return {
      x: size * Math.sqrt(3) * (q + r / 2),
      y: size * (3 / 2) * r,
    }
  }
  return {
    x: size * (3 / 2) * q,
    y: size * Math.sqrt(3) * (r + q / 2),
  }
}

/** SVG polygon points for one hex */
export function hexPoints(
  q: number,
  r: number,
  size: number,
  orientation: HexOrientation,
): string {
  const { x, y } = hexCenter(q, r, size, orientation)
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    // Flat: paired with axial layout used since MVP (0°, 60°, …).
    // Pointy: vertex at top (−90°, −30°, …).
    const deg = orientation === 'pointy' ? 60 * i - 90 : 60 * i
    const angle = (Math.PI / 180) * deg
    pts.push(`${x + size * Math.cos(angle)},${y + size * Math.sin(angle)}`)
  }
  return pts.join(' ')
}

/** Power-center crown — upper band of the hex (below top edge, above center token) */
export function powerCenterOffset(size: number, orientation: HexOrientation): { x: number; y: number } {
  if (orientation === 'pointy') {
    // Pointy-top: vertex at top; crown sits in upper third
    return { x: 0, y: -size * 0.66 }
  }
  // Flat-top: flat edge on top at y = −size·√3/2; crown slightly below that edge
  return { x: 0, y: -size * 0.52 }
}

export const ORIENTATION_STORAGE_KEY = 'galaxy-hex-orientation'
export const AUTO_FIT_STORAGE_KEY = 'galaxy-hex-autofit'

export function loadStoredOrientation(): HexOrientation {
  if (!import.meta.client) return 'flat'
  const stored = localStorage.getItem(ORIENTATION_STORAGE_KEY)
  return stored === 'pointy' ? 'pointy' : 'flat'
}

export function storeOrientation(orientation: HexOrientation): void {
  if (!import.meta.client) return
  localStorage.setItem(ORIENTATION_STORAGE_KEY, orientation)
}

/** When true, pan/zoom resets as the map grows or orientation changes */
export function loadStoredAutoFit(): boolean {
  if (!import.meta.client) return true
  return localStorage.getItem(AUTO_FIT_STORAGE_KEY) !== '0'
}

export function storeAutoFit(enabled: boolean): void {
  if (!import.meta.client) return
  localStorage.setItem(AUTO_FIT_STORAGE_KEY, enabled ? '1' : '0')
}
