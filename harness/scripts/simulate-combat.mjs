/**
 * Прогон боевого конечного автомата против живого сервера: prep → countdown →
 * авторазрешение → раунды с накоплением урона → продолжение / отступление / аварийный выход.
 *
 * После каждого шага проверяются:
 *  - инвариант `pendingCombatInvariantViolations` (пустой список = корректное состояние);
 *  - одинаковые фаза боя и `observationRevision` у всех трёх клиентов;
 *  - server-логи на автоматическое снятие боя (`combat.invariant.released`).
 *
 * Usage: node harness/scripts/simulate-combat.mjs
 *        (или `pnpm tsx harness/scripts/simulate-combat.mjs` — тогда правила берутся из src)
 */

const API = (process.env.GAME_SERVER_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')

/**
 * Правила нужны харнессу ради `pendingCombatInvariantViolations` и хелперов фаз.
 * `@galaxy/rules` не слинкован в корень репозитория, поэтому грузим пакет по пути:
 * под tsx — исходники, под обычным node — сборку `dist`.
 */
async function loadRules() {
  const candidates = [
    '../../packages/rules/src/index.ts',
    '../../packages/rules/dist/index.js',
  ]
  const failures = []
  for (const relative of candidates) {
    try {
      return await import(new URL(relative, import.meta.url).href)
    } catch (e) {
      failures.push(`${relative}: ${e.message}`)
    }
  }
  throw new Error(
    `Не удалось загрузить @galaxy/rules.\n  ${failures.join('\n  ')}\n`
    + '  Соберите правила (`pnpm --filter @galaxy/rules build`) или запустите харнесс через tsx.',
  )
}

const rules = await loadRules()
const {
  buildCombatPreviewFromPending,
  combatPrepOf,
  getCombatRetreatDestinations,
  pendingCombatInvariantViolations,
  playerCombatDice,
  playerCombatTargets,
} = rules

/** Цели кубиков, которые видит игрок, но которые назначал не он: их до броска видно быть не должно. */
function foreignDiceTargets(view) {
  const pending = view.mech.pendingCombat
  if (!pending) return []
  const options = pending.phase === 'prep' ? pending.prep?.combatOptions : pending.combatOptions
  const owner = new Map()
  for (const cell of view.mech.cells) for (const ship of cell.ships) owner.set(ship.id, ship.ownerId)
  return ['attacker', 'defender'].flatMap((side) =>
    Object.keys(options?.[side]?.diceTargets ?? {}).filter((shooterId) => owner.get(shooterId) !== view.playerId),
  )
}

/** Все кубики игрока — в одну цель: так выбор заметно отличается от автоматического. */
function focusFire(m, playerId) {
  const preview = buildCombatPreviewFromPending(m)
  if (!preview) return {}
  const target = playerCombatTargets(preview, playerId, m.pendingCombat?.damageByShipId ?? {}).at(-1)
  const out = {}
  for (const die of playerCombatDice(preview, playerId)) {
    ;(out[die.shooterShipId] ??= [])[die.index] = target?.shipId ?? ''
  }
  return out
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

/** Общий счётчик шагов и покрытие переходов на весь прогон. */
const run = {
  steps: 0,
  coverage: new Set(),
}

function combatPhaseOf(m) {
  return m.pendingCombat ? m.pendingCombat.phase : 'нет боя'
}

function fail(ctx, reason, details = []) {
  console.error('')
  console.error('=============== FAIL ===============')
  console.error(`сценарий: ${ctx.scenario}`)
  console.error(`шаг ${run.steps}: ${ctx.lastLabel ?? '—'}`)
  console.error(`причина: ${reason}`)
  for (const line of details) console.error(line)
  if (ctx.lastPendingCombat !== undefined) {
    console.error('pendingCombat:')
    console.error(JSON.stringify(ctx.lastPendingCombat, null, 2))
  }
  console.error('====================================')
  process.exit(1)
}

async function observeAll(ctx) {
  const views = []
  for (let i = 0; i < ctx.players.length; i += 1) {
    const observation = await getState(ctx.roomId, ctx.players[i])
    views.push({ playerId: ctx.players[i], name: ctx.names[i], mech: mech(observation) })
  }
  return views
}

/** Рассинхрон трёх клиентов по фазе боя или ревизии observation. */
function syncMismatch(views) {
  const phases = new Set(views.map((v) => combatPhaseOf(v.mech)))
  const revisions = new Set(views.map((v) => v.mech.observationRevision))
  if (phases.size === 1 && revisions.size === 1) return null
  return { phases: [...phases], revisions: [...revisions] }
}

/**
 * Единая проверка после каждого шага. Возвращает mechanics первого клиента.
 * Расхождение может быть легальным (сервер дотикал countdown между чтениями),
 * поэтому даём состоянию устояться и падаем только на устойчивом рассинхроне.
 */
async function checkStep(ctx, label) {
  run.steps += 1
  ctx.lastLabel = label

  let views = await observeAll(ctx)
  let mismatch = syncMismatch(views)
  let settles = 0
  while (mismatch && settles < 2) {
    settles += 1
    await sleep(300)
    views = await observeAll(ctx)
    mismatch = syncMismatch(views)
  }

  const primary = views[0].mech
  ctx.lastPendingCombat = primary.pendingCombat ?? null

  if (mismatch) {
    fail(ctx, 'клиенты видят разное состояние боя', [
      `фазы боя: ${mismatch.phases.join(' | ')}`,
      `observationRevision: ${mismatch.revisions.join(' | ')}`,
      ...views.map(
        (v) => `  ${v.name} (${v.playerId}): фаза=${combatPhaseOf(v.mech)} rev=${v.mech.observationRevision}`,
      ),
    ])
  }

  for (const view of views) {
    const foreign = foreignDiceTargets(view)
    if (foreign.length) {
      fail(ctx, `клиент ${view.name} видит чужие цели до броска`, foreign.map((id) => `  - ${id}`))
    }
    const violations = pendingCombatInvariantViolations(view.mech)
    if (violations.length) {
      ctx.lastPendingCombat = view.mech.pendingCombat ?? null
      fail(ctx, `нарушен инвариант pendingCombat (клиент ${view.name})`, [
        ...violations.map((v) => `  - ${v}`),
      ])
    }
  }

  const suffix = settles ? ` (стабилизация: ${settles})` : ''
  console.log(
    `  [шаг ${String(run.steps).padStart(2, ' ')}] ${label}`
    + ` | бой=${combatPhaseOf(primary)} rev=${primary.observationRevision}`
    + ` фаза=${primary.phase} активный=${primary.activePlayerId}${suffix}`,
  )
  return primary
}

/** Сервер снимает невалидный бой сам — по логам ловим то, что инвариант уже не покажет. */
async function assertNoReleasedCombat(ctx) {
  let logs
  try {
    logs = (await api(`/debug/logs?roomId=${ctx.roomId}`)).logs ?? []
  } catch {
    console.log('  (server-логи недоступны — пропускаем проверку combat.invariant.released)')
    return
  }
  const suspicious = logs.filter(
    (entry) => entry.event === 'combat.invariant.released' || entry.event === 'combat.auto-resolve.error',
  )
  if (suspicious.length) {
    fail(ctx, 'сервер сам снял бой или не смог его разрешить', [
      ...suspicious.map((entry) => `  - ${entry.event}: ${JSON.stringify(entry)}`),
    ])
  }
}

async function createRoomWithPlayers(map, names) {
  const { roomId, code } = await api('/rooms', {
    method: 'POST',
    body: JSON.stringify({ map, maxPlayers: names.length }),
  })
  const players = []
  for (const name of names) {
    const joined = await api(`/rooms/${roomId}/join`, {
      method: 'POST',
      body: JSON.stringify({ playerName: name }),
    })
    players.push(joined.playerId)
  }
  // Комнаты стартуют явно: хозяин — первый вошедший.
  await api(`/rooms/${roomId}/start`, {
    method: 'POST',
    body: JSON.stringify({ playerId: players[0] }),
  })
  return { roomId, code, players }
}

function cellAt(m, coord) {
  return m.cells.find((c) => c.coord.q === coord.q && c.coord.r === coord.r)
}

function findShip(m, shipId) {
  for (const cell of m.cells) {
    const ship = cell.ships.find((s) => s.id === shipId)
    if (ship) return ship
  }
  return null
}

/**
 * Решения начала хода — строго по порядку: доктрина (все разом), затем у каждого клетки
 * захвата и фишки перезарядки. Без них маркеры не ставятся и ход не передаётся.
 */
async function settlePlanningDecisions(ctx) {
  const m = mech(await getState(ctx.roomId, ctx.players[0]))
  if (m.phase !== 'planning') return
  if (m.doctrineChoice) {
    for (const playerId of ctx.players) {
      if (m.doctrineChoice.pickedBy?.includes(playerId)) continue
      await act(ctx.roomId, playerId, 'choose-doctrine', { doctrineId: 'none' })
    }
  }
  const settled = mech(await getState(ctx.roomId, ctx.players[0]))
  for (const playerId of ctx.players) {
    if (settled.claimPicksRemainingByPlayer?.[playerId]) await act(ctx.roomId, playerId, 'execute-claim-picks')
  }
  const recharged = mech(await getState(ctx.roomId, ctx.players[0]))
  for (const playerId of ctx.players) {
    if (recharged.rechargePicksRemainingByPlayer?.[playerId]) await act(ctx.roomId, playerId, 'execute-recharge-picks')
  }
}

/** Планирование: маркер действия атакующему, затем передача хода до фазы «Действия». */
async function reachAttackerTurnInActions(ctx, attackerId, markerCoord) {
  await settlePlanningDecisions(ctx)
  let guard = 16
  while (guard-- > 0) {
    const m = mech(await getState(ctx.roomId, ctx.players[0]))
    if (m.phase !== 'planning') break
    const active = m.activePlayerId
    if (active === attackerId && !m.actionMarkers.some((mk) => mk.ownerId === attackerId)) {
      await act(ctx.roomId, attackerId, 'toggle-marker', { coord: markerCoord, kind: 'action' })
    }
    await act(ctx.roomId, active, 'advance-phase')
  }

  guard = 16
  while (guard-- > 0) {
    const m = mech(await getState(ctx.roomId, ctx.players[0]))
    if (m.phase !== 'actions') {
      throw new Error(`Ожидалась фаза «Действия», получено «${m.phase}»`)
    }
    if (m.activePlayerId === attackerId) return
    await act(ctx.roomId, m.activePlayerId, 'advance-phase')
  }
  throw new Error('Ход так и не дошёл до атакующего в фазе «Действия»')
}

/**
 * Прокручивает бой до конца. `policy(n)` решает, что делать в n-м `awaiting-continue`:
 * 'continue' | 'stop' (отступление защитника) | 'abort' (аварийный выход).
 */
async function driveCombat(ctx, policy) {
  let m = await checkStep(ctx, 'бой создан')
  let continueRound = 0
  let previousPhase = combatPhaseOf(m)
  let guard = 40

  while (guard-- > 0) {
    const pending = m.pendingCombat
    if (!pending) {
      if (previousPhase === 'prep') run.coverage.add('авторазрешение по countdown')
      return m
    }

    if (pending.phase === 'prep') {
      const prep = combatPrepOf(pending)
      if (prep.phase === 'countdown') {
        run.coverage.add('countdown после двух ready')
        await sleep(500)
        previousPhase = 'prep'
        m = await checkStep(ctx, 'ожидание countdown → авторазрешение')
        continue
      }

      const attackerId = pending.attackerId
      const defenderId = prep.defenderId
      await act(ctx.roomId, attackerId, 'update-combat-prep', {
        ready: true,
        diceTargets: focusFire(m, attackerId),
      })
      run.coverage.add('update-combat-prep (обе стороны)')
      m = await checkStep(ctx, `подготовка: атакующий ${attackerId} готов`)
      if (pending.trigger !== 'bombardment') {
        await act(ctx.roomId, defenderId, 'update-combat-prep', { ready: true })
        m = await checkStep(ctx, `подготовка: защитник ${defenderId} готов`)
      }
      previousPhase = 'prep'
      continue
    }

    if (previousPhase === 'prep') run.coverage.add('авторазрешение по countdown')
    previousPhase = pending.phase

    if (pending.phase === 'awaiting-continue') {
      if (Object.keys(pending.damageByShipId ?? {}).length) {
        run.coverage.add('урон копится между раундами')
      }
      const attackerId = pending.attackerId
      const defenderId = pending.defenderIds[0]

      // До первого уничтожения отступать нельзя: стороны только выбирают цели, в любом порядке.
      if (pending.shipsDestroyedInCombat !== true) {
        await act(ctx.roomId, defenderId, 'continue-combat', { diceTargets: focusFire(m, defenderId) })
        run.coverage.add('цели перед каждым раундом')
        m = await checkStep(ctx, `раунд ${pending.roundNumber}: защитник ${defenderId} выбрал цели первым`)
        await act(ctx.roomId, attackerId, 'continue-combat', { diceTargets: focusFire(m, attackerId) })
        m = await checkStep(ctx, `раунд ${pending.roundNumber}: атакующий ${attackerId} выбрал цели → бросок`)
        continue
      }

      continueRound += 1
      const decision = policy(continueRound)

      if (decision === 'abort') {
        await act(ctx.roomId, attackerId, 'abort-combat', {})
        run.coverage.add('abort-combat')
        m = await checkStep(ctx, `аварийный выход: атакующий ${attackerId} прервал бой`)
        continue
      }

      // Порядок решений фиксирован правилами: сначала атакующий, затем защитник.
      await act(ctx.roomId, attackerId, 'continue-combat', {})
      m = await checkStep(ctx, `раунд ${pending.roundNumber}: атакующий ${attackerId} продолжает`)

      if (decision === 'continue') {
        await act(ctx.roomId, defenderId, 'continue-combat', {})
        run.coverage.add('continue-combat')
        m = await checkStep(ctx, `раунд ${pending.roundNumber}: защитник ${defenderId} продолжает → бросок`)
        continue
      }

      const retreatTo = getCombatRetreatDestinations(m, defenderId)[0]
      if (!retreatTo) {
        fail(ctx, `защитнику ${defenderId} некуда отступать — сценарий рассчитывал на свободного соседа`)
      }
      await act(ctx.roomId, defenderId, 'stop-combat', { retreatTo })
      run.coverage.add('stop-combat с отступлением')
      m = await checkStep(
        ctx,
        `отступление: защитник ${defenderId} ушёл в (${retreatTo.q},${retreatTo.r})`,
      )
      continue
    }

    fail(ctx, `неизвестная фаза боя: ${pending.phase}`)
  }

  fail(ctx, 'бой не завершился за отведённое число шагов')
}

/**
 * Два равных смешанных флота: первое уничтожение почти наверняка случится раньше, чем одна из
 * сторон кончится, — значит бой дойдёт до решения «продолжать или отступать», а линкоры
 * переживут первое попадание и покажут накопление урона.
 */
function multiRoundMap(
  fleet = (player) => [
    { type: 'battleship', player },
    { type: 'destroyer', player },
    { type: 'destroyer', player },
  ],
) {
  return {
    id: 'sim-combat-multiround',
    name: 'Sim combat: многораундовый бой',
    cells: [
      { q: 0, r: 0, startPlayer: 1, startingShips: fleet(1) },
      { q: -1, r: 0, startPlayer: 1 },
      { q: 1, r: 0, startPlayer: 2, startingShips: fleet(2) },
      { q: 2, r: 0, startPlayer: 2 },
      { q: 1, r: -1 },
      { q: 1, r: 1 },
      { q: -4, r: 0, startPlayer: 3, startingShips: [{ type: 'destroyer', player: 3 }] },
      { q: -5, r: 0, startPlayer: 3 },
    ],
  }
}

const NAMES = ['Атакующий', 'Защитник', 'Наблюдатель']

async function runScenario({ scenario, map, attackerCoord, battleCoord, policy }) {
  console.log(`\n========== ${scenario} ==========`)

  const { roomId, code, players } = await createRoomWithPlayers(map, NAMES)
  const ctx = { scenario, roomId, players, names: NAMES, lastLabel: null }
  console.log(`комната ${roomId} (${code}), игроки: ${players.join(', ')}`)

  const attackerId = players[0]
  await reachAttackerTurnInActions(ctx, attackerId, attackerCoord)

  const before = await checkStep(ctx, 'фаза «Действия», маркер у атакующего')
  const fromCell = cellAt(before, attackerCoord)
  const moves = fromCell.ships
    .filter((s) => s.ownerId === attackerId)
    .map((s) => ({ shipId: s.id, to: battleCoord }))
  if (!moves.length) throw new Error('У атакующего нет кораблей на исходной клетке')

  await act(ctx.roomId, attackerId, 'execute-marker-movement', { from: attackerCoord, moves })
  console.log(
    `движение ${moves.length} корабля(ей) (${attackerCoord.q},${attackerCoord.r})`
    + ` → (${battleCoord.q},${battleCoord.r}) запускает бой`,
  )

  const final = await driveCombat(ctx, policy)
  await assertNoReleasedCombat(ctx)

  if (final.pendingCombat) {
    fail(ctx, 'бой должен был закончиться, но pendingCombat остался')
  }
  console.log(`итог сценария: бой завершён, фаза=${final.phase}, ход=${final.turnNumber}`)
  return ctx
}

async function main() {
  console.log(`Сервер: ${API}`)
  await api('/health')

  // Исход раундов случаен: повторяем, пока не увидим и отступление, и накопленный урон.
  const REQUIRED_ATTEMPTS = 6
  for (let attempt = 1; attempt <= REQUIRED_ATTEMPTS; attempt += 1) {
    await runScenario({
      scenario: `Сценарий 1: подготовка → countdown → раунды → отступление защитника (попытка ${attempt})`,
      map: multiRoundMap(),
      attackerCoord: { q: 0, r: 0 },
      battleCoord: { q: 1, r: 0 },
      // Первый раунд играем, во втором защитник отступает.
      policy: (round) => (round === 1 ? 'continue' : 'stop'),
    })
    if (
      run.coverage.has('stop-combat с отступлением')
      && run.coverage.has('урон копится между раундами')
    ) {
      break
    }
  }

  // Эсминец против эсминца: на 6+ раунд без уничтожений выпадает в двух случаях из трёх —
  // тогда стороны выбирают цели, не имея права отступить.
  for (let attempt = 1; attempt <= 6 && !run.coverage.has('цели перед каждым раундом'); attempt += 1) {
    await runScenario({
      scenario: `Сценарий 1б: раунды без уничтожений — только выбор целей (попытка ${attempt})`,
      map: multiRoundMap((player) => [{ type: 'destroyer', player }]),
      attackerCoord: { q: 0, r: 0 },
      battleCoord: { q: 1, r: 0 },
      policy: () => 'continue',
    })
  }

  await runScenario({
    scenario: 'Сценарий 2: аварийный выход из боя (abort-combat)',
    map: multiRoundMap(),
    attackerCoord: { q: 0, r: 0 },
    battleCoord: { q: 1, r: 0 },
    policy: () => 'abort',
  })

  const required = [
    'update-combat-prep (обе стороны)',
    'countdown после двух ready',
    'авторазрешение по countdown',
    'урон копится между раундами',
    'цели перед каждым раундом',
    'continue-combat',
    'stop-combat с отступлением',
    'abort-combat',
  ]
  const missing = required.filter((key) => !run.coverage.has(key))

  console.log('\n=============== ИТОГ ===============')
  console.log(`проверено шагов: ${run.steps}`)
  for (const key of required) {
    console.log(`  ${run.coverage.has(key) ? '+' : '-'} ${key}`)
  }
  if (missing.length) {
    console.error(`FAIL: не воспроизведены переходы: ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log('PASS: инвариант pendingCombat и синхронность клиентов выдержаны на всех шагах')
}

main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
