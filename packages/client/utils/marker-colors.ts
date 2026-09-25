import { PLAYER_COLORS } from '@galaxy/rules'

/** Смешать цвет `#RRGGBB` с другим: `t = 0` — исходный, `t = 1` — второй. */
export function mixHexColor(from: string, to: string, t: number): string {
  const parse = (hex: string) => {
    const value = hex.replace('#', '')
    return [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16) || 0)
  }
  const a = parse(from)
  const b = parse(to)
  return `#${a
    .map((channel, i) => Math.round(channel + (b[i]! - channel) * t).toString(16).padStart(2, '0'))
    .join('')}`
}

export interface MarkerPalette {
  /** Заливка значка — светлый тон цвета игрока. */
  fill: string
  /** Буква и обводка значка — тёмный тон того же цвета. */
  ink: string
  /** Кольцо маркера внутри клетки. */
  ring: string
}

/**
 * Маркер действия в гамме игрока, но светлее его территории: клетку под контролем игрока
 * заливает его же насыщенный цвет, и маркер того же тона на ней бы потерялся.
 */
export function markerPaletteForSlot(slot: number): MarkerPalette {
  const color = PLAYER_COLORS[slot] ?? '#fef08a'
  return {
    fill: mixHexColor(color, '#ffffff', 0.55),
    ink: mixHexColor(color, '#000000', 0.62),
    ring: mixHexColor(color, '#ffffff', 0.45),
  }
}
