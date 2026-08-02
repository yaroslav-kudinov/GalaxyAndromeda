/**
 * Прогон боевого конечного автомата против живого сервера: prep → countdown →
 * авторазрешение → выбор уничтожения → продолжение / отступление / аварийный выход.
 *
 * После каждого шага проверяются:
 *  - инвариант `pendingCombatInvariantViolations` (пустой список = корректное состояние);
 *  - одинаковые фаза боя и `observationRevision` у всех трёх клиентов;
 *  - server-логи на автоматическое снятие боя (`combat.invariant.released`).
 *
 * Usage: node harness/scripts/simulate-combat.mjs
 *        (или `pnpm tsx harness/scripts/simulate-combat.mjs` — тогда правила берутся из src)
 */

const API = process.env.GAME_SERVER_URL ?? 'http://127.0.0.1:3001'

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
  buildDestructionSelectionState,
  combatPrepOf,
  combatRoundStateOf,
  getCombatRetreatDestinations,
  pendingCombatInvariantViolations,
} = rules

async function api(path, init) {
  const res = await fetch(`${API}${path}`, {
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

/** Планирование: маркер действия атакующему, затем передача хода до фазы «Действия». */
async function reachAttackerTurnInActions(ctx, attackerId, markerCoord) {
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

/** Корабли для уничтожения: берём фронт приоритета, помещающийся в остаток урона. */
function pickDestructionSelection(m, pending) {
  const fromServer = m.lastCombatResult?.destructionState
  const state = fromServer ?? computeDestructionState(m, pending)
  const ids = state?.immediatelyDestroyableIds ?? []
  return ids.slice(0, 1)
}

function computeDestructionState(m, pending) {
  const rs = combatRoundStateOf(pending)
  if (!rs) return null
  const [q, r] = pending.cellKey.split(',').map(Number)
  const battleCell = cellAt(m, { q, r })
  const loserShips = rs.attackerWon
    ? (battleCell?.ships ?? []).filter((s) => s.ownerId === rs.defenderId)
    : rs.incomingAttackerShipIds.map((id) => findShip(m, id)).filter(Boolean)
  const skipTypes = new Set(rs.attackerWon ? rs.defenderSkipTypes : rs.attackerSkipTypes)
  return buildDestructionSelectionState(m, loserShips, rs.remainingDamage, skipTypes)
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
      await act(ctx.roomId, attackerId, 'update-combat-prep', { ready: true })
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

    if (pending.phase === 'awaiting-destruction') {
      const rs = combatRoundStateOf(pending)
      const selection = pickDestructionSelection(m, pending)
      await act(ctx.roomId, rs.winnerId, 'confirm-combat-destruction', {
        destructionSelection: selection,
      })
      run.coverage.add('confirm-combat-destruction')
      m = await checkStep(
        ctx,
        `уничтожение: победитель ${rs.winnerId} подтвердил [${selection.join(', ') || 'без уничтожения'}]`,
      )
      continue
    }

    if (pending.phase === 'awaiting-continue') {
      continueRound += 1
      const decision = policy(continueRound)
      const attackerId = pending.attackerId
      const defenderId = pending.defenderIds[0]

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
 * Атакующий — эсминец, защитник — эсминец под щитом: щит гарантированно съедает
 * разницу очков (максимум 5 при 1d6 против 1d6), поэтому бой всегда доходит
 * до решения «продолжать или отступать».
 */
function multiRoundMap() {
  return {
    id: 'sim-combat-multiround',
    name: 'Sim combat: многораундовый бой',
    cells: [
      { q: 0, r: 0, startPlayer: 1, startingShips: [{ type: 'destroyer', player: 1 }] },
      { q: -1, r: 0, startPlayer: 1 },
      { q: 1, r: 0, startPlayer: 2, startingShips: [
        { type: 'destroyer', player: 2 },
        { type: 'shield', player: 2 },
      ] },
      { q: 2, r: 0, startPlayer: 2 },
      { q: 1, r: -1 },
      { q: 1, r: 1 },
      { q: -4, r: 0, startPlayer: 3, startingShips: [{ type: 'supply', player: 3 }] },
      { q: -5, r: 0, startPlayer: 3 },
    ],
  }
}

/**
 * У защитника нет кораблей с боевыми кубиками, поэтому атакующий побеждает всегда,
 * а очки уничтожения (3d6 = 3…18) меньше суммарного destroyCost флота защитника (20) —
 * значит победитель обязан выбирать корабли вручную.
 */
function destructionMap() {
  return {
    id: 'sim-combat-destruction',
    name: 'Sim combat: выбор уничтожения',
    cells: [
      { q: 0, r: 0, startPlayer: 1, startingShips: [
        { type: 'destroyer', player: 1 },
        { type: 'destroyer', player: 1 },
        { type: 'destroyer', player: 1 },
      ] },
      { q: -1, r: 0, startPlayer: 1 },
      { q: 1, r: 0, startPlayer: 2, startingShips: [
        { type: 'hyper', player: 2 },
        { type: 'supply', player: 2 },
        { type: 'supply', player: 2 },
        { type: 'supply', player: 2 },
      ] },
      { q: 2, r: 0, startPlayer: 2 },
      { q: 1, r: -1 },
      { q: 1, r: 1 },
      { q: -4, r: 0, startPlayer: 3, startingShips: [{ type: 'supply', player: 3 }] },
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

  await runScenario({
    scenario: 'Сценарий 1: подготовка → countdown → раунды → отступление защитника',
    map: multiRoundMap(),
    attackerCoord: { q: 0, r: 0 },
    battleCoord: { q: 1, r: 0 },
    // Первый раунд играем, во втором защитник отступает.
    policy: (round) => (round === 1 ? 'continue' : 'stop'),
  })

  const REQUIRED_DESTRUCTION_ATTEMPTS = 4
  for (let attempt = 1; attempt <= REQUIRED_DESTRUCTION_ATTEMPTS; attempt += 1) {
    await runScenario({
      scenario: `Сценарий 2: выбор уничтожения (попытка ${attempt})`,
      map: destructionMap(),
      attackerCoord: { q: 0, r: 0 },
      battleCoord: { q: 1, r: 0 },
      // Два раунда играем, дальше закрываем бой аварийным выходом.
      policy: (round) => (round >= 3 ? 'abort' : 'continue'),
    })
    if (run.coverage.has('confirm-combat-destruction')) break
  }

  await runScenario({
    scenario: 'Сценарий 3: аварийный выход из боя (abort-combat)',
    map: multiRoundMap(),
    attackerCoord: { q: 0, r: 0 },
    battleCoord: { q: 1, r: 0 },
    policy: () => 'abort',
  })

  const required = [
    'update-combat-prep (обе стороны)',
    'countdown после двух ready',
    'авторазрешение по countdown',
    'confirm-combat-destruction',
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
