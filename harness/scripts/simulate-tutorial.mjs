/**
 * Прогон обучения против живого сервера: скрипт ведёт себя как ученик — на каждом шаге делает
 * ровно то действие, которого ждёт сценарий, и проверяет, что обучение доходит до конца, а
 * итоги шагов совпадают с тем, что о них говорит текст.
 *
 * Usage: node harness/scripts/simulate-tutorial.mjs  (GAME_SERVER_URL, по умолчанию :3001)
 *        SIM_STOP_AT=<id шага> — остановиться на шаге, не закрывая долги, и оставить комнату
 */

const API = (process.env.GAME_SERVER_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')

async function api(path, init) {
  const url = `${API}/api${path}`
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path}: ${body.error ?? `HTTP ${res.status}`}`)
  return body
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const key = (c) => `${c.q},${c.r}`

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function cellAt(mech, coord) {
  return mech.cells.find((c) => c.coord.q === coord.q && c.coord.r === coord.r)
}

/** Параметры действия из шаблона шага: сценарий не знает id кораблей и маркеров — подставляем. */
function fillParams(template, mech, playerId) {
  const params = structuredClone(template.params ?? {})
  if (template.actionId === 'execute-marker-movement' || template.actionId === 'execute-marker-bombardment') {
    const from = cellAt(mech, params.from)
    const own = from.ships.filter((ship) => ship.ownerId === playerId)
    const list = params.moves ?? params.bombardments
    list.forEach((entry, i) => {
      entry.shipId = own[i]?.id
    })
  }
  if (template.actionId === 'execute-production') {
    const coord = params.ships[0].coord
    const marker = mech.actionMarkers.find((m) => m.ownerId === playerId && key(m.coord) === key(coord))
    params.markerId = marker?.id
  }
  return params
}

async function main() {
  console.log(`Сервер: ${API}`)
  const room = await api('/rooms', {
    method: 'POST',
    body: JSON.stringify({ scenarioId: 'tutorial-basics', playerName: 'Ученик' }),
  })
  const { roomId, playerId } = room
  console.log(`комната ${roomId}, ученик ${playerId}`)

  const seen = []
  let waits = 0
  let debtsSettled = 0
  for (let guard = 0; guard < 400; guard++) {
    const obs = await api(`/rooms/${roomId}/state?playerId=${playerId}`)
    const mech = obs.mechanics
    const step = obs.tutorial?.scenarioStep
    if (!step) break
    if (seen.at(-1) !== step.id) {
      seen.push(step.id)
      console.log(`  шаг ${step.stepNumber}/${step.stepCount} ${step.id}${step.manual ? ' (Далее)' : ''}`)
      checkStepOutcome(step.id, mech, playerId)
    }
    // SIM_STOP_AT=<id шага> — остановиться на шаге и оставить комнату для проверки глазами.
    if (process.env.SIM_STOP_AT === step.id) {
      console.log(`STOP: комната ${roomId}, ученик ${playerId}, шаг ${step.id}`)
      return
    }
    // Клиент не передаёт ход, пока не закрыты долги планирования, — ученик закрывает их сам,
    // явным выбором, на любом шаге. Отказ сервера здесь — тот самый тупик обучения.
    if (await settlePlanningDebts(roomId, mech, playerId)) {
      debtsSettled += 1
      continue
    }
    if (step.manual) {
      if (step.id === 'complete') break
      await api(`/rooms/${roomId}/scenario/next`, { method: 'POST', body: JSON.stringify({ playerId }) })
      continue
    }
    const allowed = step.allowedActions ?? []
    if (!allowed.length) {
      // Ожидание броска: отсчёт подготовки идёт на сервере.
      if (++waits > 40) fail(`шаг ${step.id} не продвигается`)
      await sleep(500)
      continue
    }
    const template = typeof allowed[0] === 'string' ? { actionId: allowed[0] } : allowed[0]
    const params =
      template.actionId === 'update-combat-prep' ? { ready: true } : fillParams(template, mech, playerId)
    await api(`/rooms/${roomId}/action`, {
      method: 'POST',
      body: JSON.stringify({ playerId, action: { actionId: template.actionId, params } }),
    })
  }

  if (seen.at(-1) !== 'complete') fail(`обучение остановилось на шаге ${seen.at(-1)}`)
  console.log(
    `PASS: пройдено шагов ${seen.length}, итоги шагов сходятся с текстом; `
      + `решений планирования принято: ${debtsSettled}`,
  )
}

/**
 * Долг планирования — выбрать явно: клетки захвата (первые по списку) или фишки перезарядки
 * (самые крупные). Возвращает true, если что-то отправлено.
 */
async function settlePlanningDebts(roomId, mech, playerId) {
  if (mech.phase !== 'planning') return false
  const claims = mech.claimPicksRemainingByPlayer?.[playerId] ?? 0
  if (claims > 0) {
    const candidates = mech.cells.filter(
      (c) => c.controlOwnerId !== playerId
        && c.ships.some((s) => s.ownerId === playerId)
        && !c.ships.some((s) => s.ownerId !== playerId),
    )
    await api(`/rooms/${roomId}/action`, {
      method: 'POST',
      body: JSON.stringify({
        playerId,
        action: { actionId: 'execute-claim-picks', params: { picks: candidates.slice(0, claims).map((c) => c.coord) } },
      }),
    })
    return true
  }
  const recharge = mech.rechargePicksRemainingByPlayer?.[playerId] ?? 0
  if (recharge > 0) {
    const faceDown = mech.cells
      .filter((c) => c.controlOwnerId === playerId)
      .flatMap((c) => c.resourceTokens.map((t, tokenIndex) => ({ coord: c.coord, tokenIndex, t })))
      .filter((entry) => entry.t.faceUp === false)
      .sort((a, b) => b.t.value - a.t.value)
    await api(`/rooms/${roomId}/action`, {
      method: 'POST',
      body: JSON.stringify({
        playerId,
        action: {
          actionId: 'execute-recharge-picks',
          params: { picks: faceDown.slice(0, recharge).map(({ coord, tokenIndex }) => ({ coord, tokenIndex })) },
        },
      }),
    })
    return true
  }
  return false
}

/** Текст шага утверждает, что произошло, — сверяем с доской. */
function checkStepOutcome(stepId, mech, playerId) {
  const owner = (q, r) => cellAt(mech, { q, r })?.controlOwnerId
  const ships = (q, r) => cellAt(mech, { q, r })?.ships ?? []
  switch (stepId) {
    case 'claim-result':
      if (owner(-3, 0) !== playerId || owner(-2, 0) !== playerId) {
        fail(`«Обе клетки заняты», а контроль: (-3,0) ${owner(-3, 0)}, (-2,0) ${owner(-2, 0)}`)
      }
      break
    case 'bombardment-result':
      if (ships(-2, -1).some((ship) => ship.ownerId !== playerId)) fail('после обстрела вражеский эсминец жив')
      if (ships(-3, 0).filter((ship) => ship.ownerId === playerId).length < 2) fail('крейсеры ушли с клетки обстрела')
      break
    case 'battle-result':
      if (ships(-1, 0).some((ship) => ship.ownerId !== playerId)) fail('после боя на клетке остались враги')
      if (ships(-1, 0).filter((ship) => ship.ownerId === playerId).length < 2) fail('крейсеры не вошли на клетку боя')
      if (owner(-1, 0) !== playerId) fail(`контроль клетки боя: ${owner(-1, 0)}`)
      break
  }
}

main().catch((e) => fail(e.message))
