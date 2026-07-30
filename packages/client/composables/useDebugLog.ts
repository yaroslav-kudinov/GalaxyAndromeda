const DEBUG_STORAGE_KEY = 'galaxy-debug-logs'

function isDebugEnabled(): boolean {
  if (!import.meta.client) return false
  return localStorage.getItem(DEBUG_STORAGE_KEY) === '1'
    || new URLSearchParams(window.location.search).get('debug') === '1'
}

function formatContext(context: Record<string, unknown>): string {
  return Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' ')
}

/** Локальный opt-in журнал API и синхронизации; включается без пересборки. */
export function debugLog(event: string, context: Record<string, unknown> = {}): void {
  if (!isDebugEnabled()) return
  console.info(`[galaxy] ${new Date().toISOString()} event=${event}${Object.keys(context).length ? ` ${formatContext(context)}` : ''}`)
}
