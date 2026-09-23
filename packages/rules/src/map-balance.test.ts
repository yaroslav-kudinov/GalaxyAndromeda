import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mapBalanceWarnings } from './map-editor.js'
import type { MapDefinition } from './types.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const loadMap = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as MapDefinition

describe('предупреждения о неравном старте', () => {
  it('официальные карты симметричны', () => {
    for (const id of ['duel', 'trio-start', 'maltese-cross-4', 'five-point-path', 'six-point-path']) {
      expect(mapBalanceWarnings(loadMap(`maps/bundled/${id}.json`)), id).toEqual([])
    }
    expect(mapBalanceWarnings(loadMap('harness/balance/maps/reference-duel.json'))).toEqual([])
  })

  it('неравный старт и недостижимый порог видны', () => {
    const map: MapDefinition = {
      id: 'lopsided',
      name: 'Кривая',
      victoryPowerCenters: 3,
      cells: [
        { q: 0, r: 0, startPlayer: 1, isPowerCenter: true, resourceToken: { type: 'credits', value: 7 } },
        { q: 1, r: 0, startPlayer: 2, isPowerCenter: true, startingShips: [{ type: 'cruiser', player: 2 }] },
      ],
    }
    const warnings = mapBalanceWarnings(map)
    expect(warnings[0]).toMatch(/Порог победы 3 больше числа центров власти на карте \(2\)/)
    expect(warnings.some((w) => /кредиты: игрок 1: 7, игрок 2: 0/.test(w))).toBe(true)
    expect(warnings.some((w) => /крейсер: игрок 1: 0, игрок 2: 1/.test(w))).toBe(true)
  })
})
