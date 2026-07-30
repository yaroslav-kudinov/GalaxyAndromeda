export type DebugLogFields = Record<string, unknown>

export interface DebugLogEntry {
  timestamp: string
  event: string
  [field: string]: unknown
}

const MAX_DEBUG_LOG_ENTRIES = 300
const entries: DebugLogEntry[] = []

export const debugLoggingEnabled = process.env.NODE_ENV !== 'production'

function formatValue(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Короткий structured log для локальной мультиплеерной отладки. */
export function debugLog(event: string, fields: DebugLogFields = {}): void {
  if (!debugLoggingEnabled) return

  const entry: DebugLogEntry = {
    timestamp: new Date().toISOString(),
    event,
    ...fields,
  }
  entries.push(entry)
  if (entries.length > MAX_DEBUG_LOG_ENTRIES) entries.shift()

  const context = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ')
  console.log(`[galaxy] ${entry.timestamp} event=${event}${context ? ` ${context}` : ''}`)
}

export function getDebugLogs(roomId?: string): DebugLogEntry[] {
  if (!roomId) return [...entries]
  return entries.filter((entry) => entry.roomId === roomId)
}
