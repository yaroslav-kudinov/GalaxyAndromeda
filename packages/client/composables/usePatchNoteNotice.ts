import { latestPatchNote } from '~/utils/patch-notes'

const PATCH_NOTES_SEEN_STORAGE_KEY = 'galaxy-patch-notes-seen-latest'

const seenLatestSlug = ref<string | null>(null)
const hydrated = ref(false)

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* quota / private mode */
  }
}

function hydrate(): void {
  if (!import.meta.client || hydrated.value) return
  seenLatestSlug.value = readStorage(PATCH_NOTES_SEEN_STORAGE_KEY)
  hydrated.value = true
}

export function usePatchNoteNotice() {
  if (import.meta.client) hydrate()

  const route = useRoute()

  const note = computed(() => {
    if (!hydrated.value) return null
    const latest = latestPatchNote()
    if (!latest) return null
    if (latest.slug === seenLatestSlug.value) return null
    if (route.path.startsWith('/patch-notes')) return null
    return latest
  })

  function dismiss(): void {
    const latest = latestPatchNote()
    if (!latest) return
    writeStorage(PATCH_NOTES_SEEN_STORAGE_KEY, latest.slug)
    seenLatestSlug.value = latest.slug
  }

  function markPatchNoteSeen(slug: string): void {
    const latest = latestPatchNote()
    if (!latest || slug !== latest.slug) return
    writeStorage(PATCH_NOTES_SEEN_STORAGE_KEY, slug)
    seenLatestSlug.value = slug
  }

  return { hydrated, note, dismiss, markPatchNoteSeen }
}
