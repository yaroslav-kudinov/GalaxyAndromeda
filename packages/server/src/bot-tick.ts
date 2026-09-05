import {
  advanceScenarioProgress,
  botPolicyForStep,
  buildObservation,
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

export function loadScenarioScriptById(scenarioId: string): ScenarioScript | null {
  const row = getScenarioById(scenarioId)
  if (!row) return null
  return parseScenarioScript(JSON.parse(row.script_json))
}

export function runBotTicksForRoom(
  room: Room,
  applyBotAction: (room: Room, botId: string, actionId: string, params?: Record<string, unknown>) => void,
): void {
  if (!room.botPlayerId || room.mode !== 'tutorial') return
  const botId = room.botPlayerId
  let ticks = 0

  while (ticks < MAX_BOT_TICKS && room.state.activePlayerId === botId && !room.state.gameOver) {
    ticks += 1
    const script = room.scenarioId ? loadScenarioScriptById(room.scenarioId) : null
    const policy = script ? botPolicyForStep(script, room.state.scenarioProgress) : 'passive'

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

    const picked = pickTutorialBotAction(obs, legal, policy)
    if (!picked) break

    try {
      applyBotAction(room, botId, picked.actionId, picked.params)
    } catch {
      break
    }
  }
}

export function advanceTutorialScenario(room: Room, lastAction?: ActionPayload): void {
  if (room.mode !== 'tutorial' || !room.scenarioId || !room.state.scenarioProgress) return
  const script = loadScenarioScriptById(room.scenarioId)
  if (!script) return
  room.state.scenarioProgress = advanceScenarioProgress(
    script,
    room.state.scenarioProgress,
    room.state,
    lastAction,
  )
}

export function initTutorialRoomState(room: Room, scenarioId: string): void {
  room.mode = 'tutorial'
  room.scenarioId = scenarioId
  room.botPlayerId = 'player-2'
  room.state.scenarioProgress = initScenarioProgress(scenarioId)
}

export function manualAdvanceScenarioStep(room: Room): boolean {
  if (room.mode !== 'tutorial' || !room.scenarioId || !room.state.scenarioProgress) return false
  const script = loadScenarioScriptById(room.scenarioId)
  if (!script) return false
  const next = manualAdvanceProgress(script, room.state.scenarioProgress)
  if (next.stepIndex === room.state.scenarioProgress.stepIndex && !next.completed) return false
  room.state.scenarioProgress = next
  return true
}

export function scenarioObservationExtras(room: Room): {
  scenarioId?: string
  scenarioStep?: { id: string; title: string; body: string; highlight?: unknown }
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
      ? { id: step.id, title: step.title, body: step.body, highlight: step.highlight }
      : undefined,
  }
}
