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

  it('passive готовит бота к бою с поддержкой', () => {
    const legal: LegalAction[] = [
      { id: 'surrender', type: 'surrender', description: 'Сдаться' },
      { id: 'update-combat-prep', type: 'combat', description: 'Готовность к бою' },
    ]
    const observation = {
      mechanics: {
        pendingCombat: {
          phase: 'prep',
          prep: { phase: 'prep', readyBy: {} },
        },
      },
    } as never
    const picked = pickTutorialBotAction(
      observation,
      legal,
      'passive',
      { botSupportSide: { 'player-3': 'attacker' } } as never,
      'player-3',
    )
    expect(picked).toEqual({
      actionId: 'update-combat-prep',
      params: { ready: true, supportSide: 'attacker' },
    })
  })
})
