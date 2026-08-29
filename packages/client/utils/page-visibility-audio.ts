export type VisibilityAudioIntent = 'pause' | 'resume' | 'idle'

/** Pause soundtrack when the tab is hidden; resume only if the user still wants music. */
export function visibilityAudioIntent(input: {
  hidden: boolean
  muted: boolean
  shouldBePlaying: boolean
}): VisibilityAudioIntent {
  if (input.hidden) return 'pause'
  if (!input.muted && input.shouldBePlaying) return 'resume'
  return 'idle'
}

export function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden
}

export function bindDocumentVisibility(handler: () => void): void {
  if (typeof document === 'undefined') return
  document.addEventListener('visibilitychange', handler)
}

/**
 * Pause the element on a hidden tab. Resume when visible, not muted, and the session
 * still wants audio. Caller’s play() must swallow autoplay rejection.
 */
export function syncAudioToDocumentVisibility(options: {
  hidden?: boolean
  getAudio: () => HTMLAudioElement | null
  isMuted: () => boolean
  shouldBePlaying: () => boolean
  play: () => void | Promise<void>
}): void {
  const intent = visibilityAudioIntent({
    hidden: options.hidden ?? isDocumentHidden(),
    muted: options.isMuted(),
    shouldBePlaying: options.shouldBePlaying(),
  })
  if (intent === 'pause') {
    options.getAudio()?.pause()
    return
  }
  if (intent === 'resume') {
    void options.play()
  }
}
