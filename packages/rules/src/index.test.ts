import { describe, expect, it } from 'vitest'
import { hexDistance, validateMapDefinition, getGhostSlots, createEmptyMap } from './map.js'
import { renderAsciiMapFromDefinition } from './observation/index.js'

describe('hex map', () => {
  it('computes distance between neighbors as 1', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1)
  })

  it('validates map definition', () => {
    const map = createEmptyMap()
    expect(validateMapDefinition(map)).toEqual([])
  })

  it('finds ghost slots around single hex', () => {
    const ghosts = getGhostSlots(createEmptyMap())
    expect(ghosts).toHaveLength(6)
  })

  it('renders ascii map snapshot', () => {
    const ascii = renderAsciiMapFromDefinition(createEmptyMap())
    expect(ascii).toContain('(0,0)')
    expect(ascii).toContain('Legend')
  })
})

describe('scaffold', () => {
  it('passes', () => {
    expect(true).toBe(true)
  })
})
