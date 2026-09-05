import { describe, expect, it } from 'vitest'
import { pickTutorialBotAction } from './tutorial-bot.js'
import type { LegalAction } from './types.js'

describe('pickTutorialBotAction', () => {
  const legal: LegalAction[] = [
    { id: 'surrender', type: 'surrender', description: 'Сдаться' },
    { id: 'advance-phase', type: 'advancePhase', description: 'Далее' },
  ]

  it('passive prefers advance-phase over surrender', () => {
    const picked = pickTutorialBotAction({} as never, legal, 'passive')
    expect(picked?.actionId).toBe('advance-phase')
  })

  it('simple prefers advance when no movement', () => {
    const picked = pickTutorialBotAction({} as never, legal, 'simple')
    expect(picked?.actionId).toBe('advance-phase')
  })
})
