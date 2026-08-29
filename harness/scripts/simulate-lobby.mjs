/**
 * Simulate 3-player lobby through 3 full turns (planning → actions → production → events).
 * Usage: node harness/scripts/simulate-lobby.mjs
 */
import fs from 'node:fs'

const API = (process.env.GAME_SERVER_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')

async function api(path, init) {
  const url = path.startsWith('/api') ? `${API}${path}` : `${API}/api${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status} ${path}`)
  return body
}

function mech(obs) {
  return obs.mechanics
}

function ownedCells(state, playerId) {
  return state.cells.filter((c) => c.controlOwnerId === playerId)
}

const NEIGHBORS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

/** Клетка в связном регионе ≥3 для маркера производства (rulebook). */
function productionMarkerCoord(state, playerId) {
  const owned = ownedCells(state, playerId)
  if (!owned.length) return null
  const key = (c) => `${c.coord.q},${c.coord.r}`
  const ownedByKey = new Map(owned.map((c) => [key(c), c]))
  const visited = new Set()
  let best = null

  for (const cell of owned) {
    const startKey = key(cell)
    if (visited.has(startKey)) continue
    const stack = [cell]
    const component = []
    while (stack.length) {
      const cur = stack.pop()
      const k = key(cur)
      if (visited.has(k)) continue
      visited.add(k)
      component.push(cur)
      for (const d of NEIGHBORS) {
        const nk = `${cur.coord.q + d.q},${cur.coord.r + d.r}`
        const next = ownedByKey.get(nk)
        if (next) stack.push(next)
      }
    }
    if (component.length >= 3 && (!best || component.length > best.component.length)) {
      best = { cell: component[0], component }
    }
  }
  return best?.cell.coord ?? null
}

function cellWithOwnShip(state, playerId) {
  return state.cells.find(
    (c) => c.controlOwnerId === playerId && c.ships.some((s) => s.ownerId === playerId),
  )
}

async function getState(roomId, playerId) {
  return api(`/rooms/${roomId}/state?playerId=${playerId}&geometry=0`)
}

async function act(roomId, playerId, actionId, params) {
  return api(`/rooms/${roomId}/action?geometry=0`, {
    method: 'POST',
    body: JSON.stringify({ playerId, action: { actionId, params } }),
  })
}

async function toggleMarker(roomId, playerId, coord, kind) {
  return act(roomId, playerId, 'toggle-marker', { coord, kind })
}

async function removeMarker(roomId, playerId, markerId, kind) {
  return act(roomId, playerId, 'remove-marker', { markerId, kind })
}

async function advancePhase(roomId, playerId) {
  return act(roomId, playerId, 'advance-phase')
}

async function planningTurn(roomId, playerId, label) {
  const m = mech(await getState(roomId, playerId))
  if (m.activePlayerId !== playerId) {
    throw new Error(`${label}: not active (is ${m.activePlayerId})`)
  }

  const shipCell = cellWithOwnShip(m, playerId)

  if (shipCell) {
    await toggleMarker(roomId, playerId, shipCell.coord, 'action')
    console.log(`  ${label}: +action @ (${shipCell.coord.q},${shipCell.coord.r})`)
  }

  const prodCoord = productionMarkerCoord(m, playerId)
  if (prodCoord) {
    await toggleMarker(roomId, playerId, prodCoord, 'production')
    console.log(`  ${label}: +production @ (${prodCoord.q},${prodCoord.r})`)
  }

  await advancePhase(roomId, playerId)
}

async function resolveActionMarkers(roomId, players, names) {
  let safety = 30
  while (safety-- > 0) {
    const m = mech(await getState(roomId, players[0]))
    if (m.phase !== 'actions') break
    const pid = m.activePlayerId
    const idx = players.indexOf(pid)
    const label = names[idx] ?? pid
    const mine = m.actionMarkers.filter((mk) => mk.ownerId === pid)
    if (mine.length) {
      await removeMarker(roomId, pid, mine[0].id, 'action')
      console.log(`  ${label}: removed action marker`)
    }
    await advancePhase(roomId, pid)
  }
}

async function resolveProductionMarkers(roomId, players, names) {
  let safety = 30
  while (safety-- > 0) {
    const m = mech(await getState(roomId, players[0]))
    if (m.phase !== 'production') break
    const pid = m.activePlayerId
    const idx = players.indexOf(pid)
    const label = names[idx] ?? pid
    const mine = m.productionMarkers.filter((mk) => mk.ownerId === pid)
    if (mine.length) {
      await removeMarker(roomId, pid, mine[0].id, 'production')
      console.log(`  ${label}: removed production marker`)
    }
    await advancePhase(roomId, pid)
  }
}

async function runTurn(roomId, players, names, turnNum) {
  console.log(`\n========== TURN ${turnNum} ==========`)

  let m = mech(await getState(roomId, players[0]))
  if (m.phase === 'events') {
    await advancePhase(roomId, players[0])
    await advancePhase(roomId, players[0])
    console.log('  events resolved -> planning')
  }

  console.log('Planning:')
  for (let i = 0; i < 3; i++) {
    await planningTurn(roomId, players[i], names[i])
    const m = mech(await getState(roomId, players[0]))
    console.log(`  after ${names[i]}: phase=${m.phase} active=${m.activePlayerId}`)
  }

  console.log('Actions (remove markers):')
  await resolveActionMarkers(roomId, players, names)
  m = mech(await getState(roomId, players[0]))
  console.log(`  -> phase=${m.phase} turn=${m.turnNumber}`)

  console.log('Production (remove markers):')
  await resolveProductionMarkers(roomId, players, names)
  m = mech(await getState(roomId, players[0]))
  console.log(`  -> phase=${m.phase} turn=${m.turnNumber} active=${m.activePlayerId}`)
}

async function main() {
  const map = {
    id: 'sim-3p',
    name: 'Sim 3 players',
    cells: [
      { q: 0, r: 0, startPlayer: 1, startingShips: [{ type: 'supply', player: 1 }] },
      { q: 1, r: 0, startPlayer: 1 },
      { q: 2, r: 0, startPlayer: 1 },
      { q: 3, r: 0, startPlayer: 2, startingShips: [{ type: 'supply', player: 2 }] },
      { q: 4, r: 0, startPlayer: 2 },
      { q: 5, r: 0, startPlayer: 2 },
      { q: -3, r: 0, startPlayer: 3, startingShips: [{ type: 'supply', player: 3 }] },
      { q: -2, r: 0, startPlayer: 3 },
      { q: -1, r: 0, startPlayer: 3 },
    ],
  }

  const { roomId, code } = await api('/rooms', {
    method: 'POST',
    body: JSON.stringify({ map, maxPlayers: 3 }),
  })
  console.log('Room', roomId, code)

  const names = ['AI-1', 'AI-2', 'AI-3']
  const players = []
  for (const name of names) {
    const j = await api(`/rooms/${roomId}/join`, {
      method: 'POST',
      body: JSON.stringify({ playerName: name }),
    })
    players.push(j.playerId)
  }

  let m = mech(await getState(roomId, players[0]))
  console.log('Start:', m.phase, 'participating:', m.participatingPlayerIds)

  for (let t = 1; t <= 3; t++) {
    await runTurn(roomId, players, names, t)
  }

  m = mech(await getState(roomId, players[0]))
  console.log('\n=== DONE ===')
  console.log('phase:', m.phase, 'turn:', m.turnNumber, 'participating:', m.participatingPlayerIds)
  if (m.turnNumber < 2) {
    throw new Error('Did not complete 3 turns (turnNumber still ' + m.turnNumber + ')')
  }
  console.log('OK: 3 turns completed')
}

main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
