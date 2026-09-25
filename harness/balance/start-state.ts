#!/usr/bin/env tsx
/**
 * Стартовые позиции карт: у кого сколько клеток, центров, фишек и кораблей на старте и как далеко
 * от стартовых центров каждого игрока лежат остальные центры власти. Помогает понять перекос
 * мест в замерах, не открывая редактор.
 *
 *   pnpm balance:start --map @4+
 *   pnpm balance:start --map duel,trio-start
 */

import {
  beginMatchForParticipants,
  gameSnapshotFromMap,
  hexDistance,
} from '../../packages/rules/src/index.js'
import { seatIdsOf } from './bot.js'
import { loadMap, resolveMapNames } from './maps.js'
import { parseFlags } from './results.js'

const { flags } = parseFlags(process.argv.slice(2))
for (const name of resolveMapNames(flags.get('map') || '@published')) {
  const map = loadMap(name)
  const game = gameSnapshotFromMap(map)
  const seats = seatIdsOf(map)
  beginMatchForParticipants(game, map.id, seats)
  console.log(`== ${map.id}: мест ${seats.length}, порог ${game.victoryPowerCenters}, лимит ходов ${game.turnLimit ?? '—'}`)
  for (const id of seats) {
    const owned = game.cells.filter((cell) => cell.controlOwnerId === id)
    const ships = game.cells.flatMap((cell) => cell.ships.filter((ship) => ship.ownerId === id).map((ship) => `${ship.type}@${cell.coord.q},${cell.coord.r}`))
    const centers = owned.filter((cell) => cell.isPowerCenter).map((cell) => `${cell.coord.q},${cell.coord.r}`)
    const tokens = owned.reduce((sum, cell) => sum + cell.resourceTokens.reduce((acc, token) => acc + token.value, 0), 0)
    console.log(`${id}: клеток ${owned.length}, центры ${centers.join(' ')}, фишек ${tokens}, корабли ${ships.join(' ')}`)
  }
  console.log(`центр власти: хозяин, расстояние от ближайшего стартового центра места (${seats.join(', ')}), фишки`)
  for (const pc of game.cells.filter((cell) => cell.isPowerCenter)) {
    const distances = seats.map((id) => {
      const mine = game.cells.filter((cell) => cell.controlOwnerId === id && cell.isPowerCenter)
      return Math.min(...mine.map((cell) => hexDistance(cell.coord, pc.coord)))
    })
    const tokens = pc.resourceTokens.map((token) => `${token.type === 'credits' ? 'к' : 'п'}${token.value}`).join('')
    console.log(`  ${pc.coord.q},${pc.coord.r}: ${pc.controlOwnerId ?? 'нейтральный'}, ${distances.join(' ')}, ${tokens || '—'}`)
  }
}
