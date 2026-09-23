import {
  advanceScenarioProgress,
  botPolicyForPlayer,
  buildObservation,
  getCurrentStep,
  getLegalActionsForSnapshot,
  parseScenarioScript,
  pickTutorialBotAction,
  initScenarioProgress,
  manualAdvanceProgress,
  type ActionPayload,
  type ScenarioScript,
} from '@galaxy/rules'
import { getScenarioById } from './db/index.js'
import type { Room } from './room.js'

const MAX_BOT_TICKS = 24
const OUT_OF_TURN_BOT_ACTIONS = new Set([
  'update-combat-prep',
  'continue-combat',
  'stop-combat',
])

export function tutorialBotIds(room: Room): string[] {
  if (room.botPlayerIds?.length) return room.botPlayerIds
  return room.botPlayerId ? [room.botPlayerId] : []
}

export function loadScenarioScriptById(scenarioId: string): ScenarioScript | null {
  const row = getScenarioById(scenarioId)
  if (!row) return null
  return parseScenarioScript(JSON.parse(row.script_json))
}

export function runBotTicksForRoom(
  room: Room,
  applyBotAction: (room: Room, botId: string, actionId: string, params?: Record<string, unknown>) => void,
): void {
  const botIds = tutorialBotIds(room)
  if (!botIds.length || room.mode !== 'tutorial') return
  let ticks = 0

  while (ticks < MAX_BOT_TICKS && !room.state.gameOver) {
    const script = room.scenarioId ? loadScenarioScriptById(room.scenarioId) : null
    const step = script ? getCurrentStep(script, room.state.scenarioProgress) : null
    let acted = false

    for (const botId of botIds) {
      const policy = script
        ? botPolicyForPlayer(script, room.state.scenarioProgress, botId)
        : 'passive'

      const legal = getLegalActionsForSnapshot(room.state, room.map.id, botId)
      const obs = buildObservation(
        {
          ...room.state,
          mapId: room.map.id,
          mapName: room.map.name,
        } as Parameters<typeof buildObservation>[0],
        legal,
        { geometry: false },
      )

      const picked = pickTutorialBotAction(obs, legal, policy, step ?? undefined, botId)
      if (!picked) continue
      if (
        room.state.activePlayerId !== botId
        && !OUT_OF_TURN_BOT_ACTIONS.has(picked.actionId)
      ) continue

      try {
        applyBotAction(room, botId, picked.actionId, picked.params)
        advanceTutorialScenario(
          room,
          { actionId: picked.actionId, params: picked.params },
          botId,
        )
        ticks += 1
        acted = true
        break
      } catch {
        continue
      }
    }
    if (!acted) break
  }
}

export function advanceTutorialScenario(
  room: Room,
  lastAction?: ActionPayload,
  lastActorId?: string,
): boolean {
  if (room.mode !== 'tutorial' || !room.scenarioId || !room.state.scenarioProgress) return false
  const script = loadScenarioScriptById(room.scenarioId)
  if (!script) return false
  const previous = room.state.scenarioProgress
  const next = advanceScenarioProgress(
    script,
    previous,
    room.state,
    lastAction,
    lastActorId,
    { hasCombatResult: room.lastCombatResult != null },
  )
  room.state.scenarioProgress = next
  return next.stepIndex !== previous.stepIndex || next.completed !== previous.completed
}

/**
 * После обстрела/боя не передаём ход, пока игрок не увидит итог:
 * шаг ожидания броска или ручной шаг «что произошло».
 */
export function tutorialShouldHoldActionTurnForCombatResult(room: Room): boolean {
  if (!room.lastCombatResult || room.mode !== 'tutorial') return false
  if (!room.scenarioId || !room.state.scenarioProgress) return false
  const script = loadScenarioScriptById(room.scenarioId)
  const step = script ? getCurrentStep(script, room.state.scenarioProgress) : null
  if (!step) return false
  if (step.advanceWhen.type === 'manual') return true
  return step.advanceWhen.type === 'combat' && step.advanceWhen.status === 'resolved'
}

export function initTutorialRoomState(
  room: Room,
  scenarioId: string,
  script = loadScenarioScriptById(scenarioId),
): void {
  room.mode = 'tutorial'
  room.scenarioId = scenarioId
  const bots = script?.bots?.length
    ? script.bots
    : [{ playerId: script?.botPlayerId ?? 'player-2', name: script?.botName ?? 'Тренировочный противник' }]
  room.botPlayerIds = bots.map((bot) => bot.playerId)
  room.botPlayerId = room.botPlayerIds[0]
  room.state.scenarioProgress = initScenarioProgress(scenarioId)
}

export function manualAdvanceScenarioStep(room: Room): boolean {
  if (room.mode !== 'tutorial' || !room.scenarioId || !room.state.scenarioProgress) return false
  const script = loadScenarioScriptById(room.scenarioId)
  if (!script) return false
  const next = manualAdvanceProgress(script, room.state.scenarioProgress)
  if (next.stepIndex === room.state.scenarioProgress.stepIndex && !next.completed) return false
  room.state.scenarioProgress = next
  // «Далее» на шаге после боя — игрок осознал итог; можно снова передавать ход.
  room.lastCombatResult = undefined
  return true
}

export function scenarioObservationExtras(room: Room): {
  scenarioId?: string
  scenarioStep?: {
    id: string
    title: string
    body: string
    objective?: string
    why?: string
    hint?: string
    highlight?: unknown
    manual: boolean
    stepNumber: number
    stepCount: number
    allowedActions?: import('@galaxy/rules').ScenarioStep['allowedActions']
  }
  tutorialMode?: boolean
} {
  if (room.mode !== 'tutorial' || !room.scenarioId) return {}
  const script = loadScenarioScriptById(room.scenarioId)
  if (!script) return { tutorialMode: true, scenarioId: room.scenarioId }
  const progress = room.state.scenarioProgress
  const step =
    progress && !progress.completed ? script.steps[progress.stepIndex] : null
  return {
    tutorialMode: true,
    scenarioId: room.scenarioId,
    scenarioStep: step
      ? {
          id: step.id,
          title: step.title,
          body: step.body,
          objective: step.objective,
          why: step.why,
          hint: step.hint,
          highlight: step.highlight,
          manual: step.advanceWhen.type === 'manual',
          stepNumber: (progress?.stepIndex ?? 0) + 1,
          stepCount: script.steps.length,
          allowedActions: step.allowedActions,
        }
      : undefined,
  }
}
