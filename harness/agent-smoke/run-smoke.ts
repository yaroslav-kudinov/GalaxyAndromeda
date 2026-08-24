#!/usr/bin/env tsx
/**
 * Smoke test: server health + create room + get state with ASCII geometry
 * Run: pnpm --filter @galaxy/server dev (separate terminal)
 *      tsx harness/agent-smoke/run-smoke.ts
 */
const BASE = process.env.GAME_SERVER_URL ?? 'http://127.0.0.1:3001'

async function main() {
  const health = await fetch(`${BASE}/health`)
  if (!health.ok) throw new Error('Server not running')
  console.log('health:', await health.json())

  const map = {
    id: 'smoke',
    name: 'Smoke',
    cells: [{ q: 0, r: 0, isPowerCenter: true }],
  }

  const roomRes = await fetch(`${BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ map, maxPlayers: 4 }),
  })
  const { roomId } = (await roomRes.json()) as { roomId: string }
  console.log('room:', roomId)

  const joinRes = await fetch(`${BASE}/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName: 'SmokeBot' }),
  })
  const { playerId } = (await joinRes.json()) as { playerId: string }

  const startRes = await fetch(`${BASE}/rooms/${roomId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId }),
  })
  if (!startRes.ok) throw new Error(`start failed: ${await startRes.text()}`)

  const stateRes = await fetch(`${BASE}/rooms/${roomId}/state?playerId=${playerId}`)
  const obs = (await stateRes.json()) as { geometry: { asciiMap: string } }
  console.log('asciiMap:\n', obs.geometry.asciiMap)
  console.log('SMOKE OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
