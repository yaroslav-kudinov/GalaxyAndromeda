import { debugLog } from './useDebugLog'

type ObservationSource = 'action' | 'poll' | 'resync' | 'initial'

interface UseObservationSyncOptions {
  enabled: () => boolean
  fetchAndApply: () => Promise<boolean>
}

const MAX_RESYNC_ATTEMPTS = 3
const POLL_FAILURE_LIMIT = 3
const RESYNC_BACKOFF_MS = [0, 500, 1_200]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Следит за monotonic observationRevision и восстанавливает authoritative state.
 * Локальное состояние меняется только через переданный fetchAndApply.
 */
export function useObservationSync(options: UseObservationSyncOptions) {
  const warningVisible = ref(false)
  const warningReason = ref<string | null>(null)
  const resyncing = ref(false)

  let lastRevision = 0
  let expectedRevision: number | null = null
  let consecutivePollFailures = 0
  let resyncPromise: Promise<boolean> | null = null

  function showWarning(reason: string) {
    warningReason.value = reason
    warningVisible.value = true
    debugLog('sync.warning', { reason, lastRevision })
  }

  async function resync(reason: string): Promise<boolean> {
    if (!options.enabled()) return false
    if (resyncPromise) return resyncPromise

    resyncPromise = (async () => {
      resyncing.value = true
      debugLog('sync.resync-start', { reason, lastRevision })
      for (let attempt = 0; attempt < MAX_RESYNC_ATTEMPTS; attempt++) {
        if (RESYNC_BACKOFF_MS[attempt]) await sleep(RESYNC_BACKOFF_MS[attempt])
        try {
          if (await options.fetchAndApply()) {
            consecutivePollFailures = 0
            warningVisible.value = false
            warningReason.value = null
            debugLog('sync.resync-success', { reason, attempt: attempt + 1, lastRevision })
            return true
          }
        } catch (error) {
          debugLog('sync.resync-failure', {
            reason,
            attempt: attempt + 1,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      showWarning(reason)
      return false
    })().finally(() => {
      resyncing.value = false
      resyncPromise = null
    })

    return resyncPromise
  }

  function expectNextRevision() {
    if (!options.enabled()) return
    expectedRevision = lastRevision + 1
  }

  function observe(revision: number | undefined, source: ObservationSource): boolean {
    if (revision == null) return true

    if (revision < lastRevision) {
      debugLog('sync.stale-observation', { source, revision, lastRevision })
      void resync('Получен устаревший ответ сервера.')
      return false
    }

    const actionDidNotAdvance =
      source === 'action'
      && expectedRevision != null
      && revision < expectedRevision

    lastRevision = revision
    if (revision >= (expectedRevision ?? revision)) {
      expectedRevision = null
    }

    if (actionDidNotAdvance) {
      debugLog('sync.action-revision-unchanged', { revision, expectedRevision })
      void resync('После действия состояние сервера не обновилось.')
    }
    return true
  }

  function recordPollSuccess() {
    consecutivePollFailures = 0
  }

  function recordPollFailure(error: unknown) {
    if (!options.enabled()) return
    consecutivePollFailures++
    debugLog('sync.poll-failure', {
      consecutivePollFailures,
      error: error instanceof Error ? error.message : String(error),
    })
    if (consecutivePollFailures >= POLL_FAILURE_LIMIT) {
      void resync('Не удаётся получить актуальное состояние с сервера.')
    }
  }

  return {
    warningVisible,
    warningReason,
    resyncing,
    expectNextRevision,
    observe,
    recordPollSuccess,
    recordPollFailure,
    resync,
  }
}
