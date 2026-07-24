import type { Phase } from './types.js'

export const PHASE_ORDER: Phase[] = ['events', 'planning', 'actions', 'production']

export function nextPhase(current: Phase): Phase {
  const idx = PHASE_ORDER.indexOf(current)
  return PHASE_ORDER[(idx + 1) % PHASE_ORDER.length]
}
