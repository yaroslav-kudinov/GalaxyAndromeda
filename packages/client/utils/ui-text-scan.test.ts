import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasUiText, scanUiText } from './ui-text-scan'

test('текст в разметке находится вместе с номером строки', () => {
  const hits = scanUiText('<template>\n  <p>Ваш ход</p>\n</template>')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.line, 2)
  assert.equal(hits[0]!.text, 'Ваш ход')
})

test('строковый литерал в скрипте находится', () => {
  const hits = scanUiText("const label = 'Завершить ход'")
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.text, 'Завершить ход')
})

test('комментарии на русском не считаются', () => {
  const source = [
    '<!-- пояснение к разметке -->',
    '// строчный комментарий',
    '/* блочный комментарий */',
    '/** документирующий комментарий */',
  ].join('\n')
  assert.deepEqual(scanUiText(source), [])
})

test('стили не считаются', () => {
  const source = '<style scoped>\n/* подпись под картой */\n.hint { color: red; }\n</style>'
  assert.deepEqual(scanUiText(source), [])
})

test('обращение к словарю нарушением не является', () => {
  const source = '<template>\n  <p>{{ t.yourTurn }}</p>\n</template>'
  assert.deepEqual(scanUiText(source), [])
})

test('двойной слэш в ссылке не принимается за комментарий', () => {
  const hits = scanUiText("const url = 'https://example.com'\nconst label = 'Правила'")
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.line, 2)
})

test('одиночные буквы пропускаются', () => {
  assert.deepEqual(scanUiText('<span>ч</span>'), [])
})

test('несколько фрагментов в одной строке находятся по отдельности', () => {
  const hits = scanUiText("const a = 'Да'; const b = 'Нет'")
  assert.equal(hits.length, 2)
})

test('нумерация строк не сбивается после вырезанных блоков', () => {
  const source = ['<style>', '.a { color: red }', '</style>', '<p>Ход игрока</p>'].join('\n')
  const hits = scanUiText(source)
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.line, 4)
})

test('hasUiText отвечает коротко', () => {
  assert.equal(hasUiText('<p>Победа</p>'), true)
  assert.equal(hasUiText('<p>{{ t.win }}</p>'), false)
})
