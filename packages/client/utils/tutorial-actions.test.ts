import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SCENARIO_FORBIDDEN_ACTIONS } from '@galaxy/rules'
import { tutorialAllowsAction } from './tutorial-actions'

const ALL_LEGAL = [
  { id: 'advance-phase' },
  { id: 'toggle-marker' },
  { id: 'surrender' },
]

describe('tutorialAllowsAction', () => {
  it('вне обучения не ограничивает ничего', () => {
    assert.equal(
      tutorialAllowsAction('surrender', {
        tutorialMode: false,
        allowedActions: [],
        legalActions: [],
      }),
      true,
    )
  })

  it('на шаге разрешено только то, что перечислено в шаге', () => {
    const args = {
      tutorialMode: true,
      allowedActions: ['advance-phase'],
      legalActions: ALL_LEGAL,
    } as const
    assert.equal(tutorialAllowsAction('advance-phase', args), true)
    assert.equal(tutorialAllowsAction('toggle-marker', args), false)
  })

  it('шаг с координатами сверяется по имени действия', () => {
    const args = {
      tutorialMode: true,
      allowedActions: [{ actionId: 'toggle-marker', params: { coord: { q: -5, r: 0 } } }],
      legalActions: ALL_LEGAL,
    } as const
    assert.equal(tutorialAllowsAction('toggle-marker', args), true)
    assert.equal(tutorialAllowsAction('advance-phase', args), false)
  })

  it('информационный шаг не разрешает ничего', () => {
    assert.equal(
      tutorialAllowsAction('advance-phase', {
        tutorialMode: true,
        allowedActions: [],
        legalActions: ALL_LEGAL,
      }),
      false,
    )
  })

  it('без шага опирается на законные действия сервера', () => {
    const args = {
      tutorialMode: true,
      allowedActions: undefined,
      legalActions: [{ id: 'advance-phase' }],
    } as const
    assert.equal(tutorialAllowsAction('advance-phase', args), true)
    assert.equal(tutorialAllowsAction('toggle-marker', args), false)
  })

  it('«сдаться» не разрешено ни на шаге, ни после прохождения сценария', () => {
    // Шаг со «сдаться» в списке — так его не задаёт ни один сценарий, но запрет сильнее списка.
    assert.equal(
      tutorialAllowsAction('surrender', {
        tutorialMode: true,
        allowedActions: ['surrender'],
        legalActions: ALL_LEGAL,
      }),
      false,
    )
    // Сценарий пройден: шага нет, сервер «сдаться» считает законным — на полигоне всё равно нельзя.
    assert.equal(
      tutorialAllowsAction('surrender', {
        tutorialMode: true,
        allowedActions: undefined,
        legalActions: ALL_LEGAL,
      }),
      false,
    )
    // Остальные действия после прохождения доступны: полигон становится свободным.
    assert.equal(
      tutorialAllowsAction('toggle-marker', {
        tutorialMode: true,
        allowedActions: undefined,
        legalActions: ALL_LEGAL,
      }),
      true,
    )
  })

  it('список запрещённых действий не пуст — иначе запрет не работает', () => {
    assert.ok(SCENARIO_FORBIDDEN_ACTIONS.has('surrender'))
  })
})
