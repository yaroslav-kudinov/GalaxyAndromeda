/**
 * Защита от повторения бага «наблюдатель видит пустое окно боя».
 *
 * У постороннего наблюдателя окно боя создаётся уже с готовым итогом раунда,
 * поэтому watch с immediate: true запускает показ бросков прямо во время setup.
 * Если состояние анимации объявлено ниже по файлу, оно попадает во временную
 * мёртвую зону, setup падает с ReferenceError и окно боя не отрисовывается.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const componentPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../components/BattleModal.vue',
)
const source = readFileSync(componentPath, 'utf8')

/** Позиция немедленного watch, который может запустить анимацию во время setup */
function immediateRollWatchIndex(): number {
  const start = source.indexOf('tryStartRollingAnimation()\n  },\n  { immediate: true },')
  assert.notEqual(
    start,
    -1,
    'Не найден watch с immediate: true, запускающий анимацию бросков — обнови тест вместе с компонентом',
  )
  // Начало самого вызова watch(, а не тела колбэка
  const watchStart = source.lastIndexOf('watch(', start)
  assert.notEqual(watchStart, -1)
  return watchStart
}

const DECLARATIONS = [
  'let revealTimer',
  'const destructionReviewReady',
  'let destructionReviewTimer',
]

test('состояние анимации бросков объявлено до немедленного watch', () => {
  const watchIndex = immediateRollWatchIndex()
  for (const declaration of DECLARATIONS) {
    const index = source.indexOf(declaration)
    assert.notEqual(index, -1, `Объявление «${declaration}» не найдено в BattleModal.vue`)
    assert.ok(
      index < watchIndex,
      `«${declaration}» объявлено после немедленного watch — у наблюдателя окно боя упадёт с ReferenceError`,
    )
  }
})

test('анимация бросков всё ещё стартует из setup, а не только после монтирования', () => {
  // Если это перестанет быть правдой, тест выше можно снимать — но осознанно.
  assert.ok(
    source.includes('{ immediate: true },'),
    'Ожидался watch с immediate: true вокруг запуска анимации бросков',
  )
})
