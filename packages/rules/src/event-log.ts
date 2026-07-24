import type { GameEvent } from './types.js'

export const MAX_EVENT_LOG_ENTRIES = 200

export function trimGameEventLog(
  state: { eventLog: GameEvent[] },
  maxEntries = MAX_EVENT_LOG_ENTRIES,
): void {
  if (state.eventLog.length > maxEntries) {
    state.eventLog.splice(0, state.eventLog.length - maxEntries)
  }
}
