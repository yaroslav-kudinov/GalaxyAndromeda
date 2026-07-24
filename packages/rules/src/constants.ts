import type { ShipType } from './types.js'

/** Player slot 1–6 colors (match TTS-style palette) */
export const PLAYER_COLORS: Record<number, string> = {
  1: '#3B82F6',
  2: '#22C55E',
  3: '#EF4444',
  4: '#A855F7',
  5: '#F59E0B',
  6: '#06B6D4',
}

export const PLAYER_LABELS: Record<number, string> = {
  1: 'Синий',
  2: 'Зелёный',
  3: 'Красный',
  4: 'Фиолетовый',
  5: 'Янтарный',
  6: 'Бирюзовый',
}

/** Max ships of one player in a single hex (game + editor) */
export const MAX_SHIPS_PER_CELL_PER_PLAYER = 4

/** Max ships total in a hex when multiple players present (e.g. battle) */
export const MAX_SHIPS_PER_CELL = MAX_SHIPS_PER_CELL_PER_PLAYER * 2

export const SHIP_TYPES: ShipType[] = [
  'supply',
  'destroyer',
  'cruiser',
  'battleship',
  'shield',
  'hyper',
]

export const SHIP_LABELS: Record<ShipType, string> = {
  supply: 'Снабжение',
  destroyer: 'Эсминец',
  cruiser: 'Крейсер',
  battleship: 'Линкор',
  shield: 'Щитоносец',
  hyper: 'Г.О.',
}

export const SHIP_ABBREV: Record<ShipType, string> = {
  supply: 'SP',
  destroyer: 'DD',
  cruiser: 'CR',
  battleship: 'BB',
  shield: 'SH',
  hyper: 'HY',
}
