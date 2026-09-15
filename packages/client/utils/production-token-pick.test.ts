import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  groupTokenViewsByCell,
  pickedTokenCellKeys,
  pruneTokenKeys,
  tokenKeyForCellClick,
  tokenPickCellKeys,
  tokenPickEntries,
  tokenSpendRefs,
  toggleTokenKey,
  tokenPickCoverage,
  tokenPickTotals,
  type RegionTokenView,
  type TokenPickEntry,
} from './production-token-pick'

const ENTRIES: TokenPickEntry[] = [
  { key: '0,0:0', type: 'credits', value: 3 },
  { key: '1,0:0', type: 'credits', value: 2 },
  { key: '1,0:1', type: 'production', value: 4 },
  { key: '2,-1:0', type: 'production', value: 1 },
]

test('суммы считаются по выбранным фишкам', () => {
  const totals = tokenPickTotals(ENTRIES, ['0,0:0', '1,0:1'])
  assert.deepEqual(totals, { credits: 3, production: 4 })
})

test('пустой выбор даёт нули', () => {
  assert.deepEqual(tokenPickTotals(ENTRIES, []), { credits: 0, production: 0 })
})

test('неизвестные ключи не считаются', () => {
  assert.deepEqual(tokenPickTotals(ENTRIES, ['9,9:0']), { credits: 0, production: 0 })
})

test('нехватка показывает, чего именно не хватает', () => {
  const coverage = tokenPickCoverage({ credits: 3, production: 1 }, { credits: 5, production: 4 })
  assert.equal(coverage.covered, false)
  assert.equal(coverage.creditsMissing, 2)
  assert.equal(coverage.productionMissing, 3)
})

test('покрытие с переплатой считается достаточным', () => {
  const coverage = tokenPickCoverage({ credits: 6, production: 4 }, { credits: 5, production: 4 })
  assert.equal(coverage.covered, true)
  assert.equal(coverage.creditsExtra, 1)
  assert.equal(coverage.productionExtra, 0)
})

test('переключение добавляет и убирает ключ', () => {
  assert.deepEqual(toggleTokenKey([], '0,0:0'), ['0,0:0'])
  assert.deepEqual(toggleTokenKey(['0,0:0', '1,0:0'], '0,0:0'), ['1,0:0'])
})

test('исчезнувшие фишки выпадают из выбора', () => {
  assert.deepEqual(pruneTokenKeys(ENTRIES, ['0,0:0', '5,5:0']), ['0,0:0'])
})

const VIEWS: RegionTokenView[] = [
  { key: '0,0:0', coord: { q: 0, r: 0 }, tokenIndex: 0, token: { type: 'credits' as const, value: 3 }, value: 3 },
  { key: '1,0:0', coord: { q: 1, r: 0 }, tokenIndex: 0, token: { type: 'credits' as const, value: 2 }, value: 2 },
  { key: '1,0:1', coord: { q: 1, r: 0 }, tokenIndex: 1, token: { type: 'production' as const, value: 4 }, value: 4 },
]

test('записи для подсчёта строятся из фишек региона', () => {
  assert.deepEqual(tokenPickEntries(VIEWS), [
    { key: '0,0:0', type: 'credits', value: 3 },
    { key: '1,0:0', type: 'credits', value: 2 },
    { key: '1,0:1', type: 'production', value: 4 },
  ])
})

test('фишки группируются по клеткам', () => {
  const groups = groupTokenViewsByCell(VIEWS)
  assert.deepEqual(groups.map((g) => g.cellKey), ['0,0', '1,0'])
  assert.equal(groups[1]!.tokens.length, 2)
})

test('клетки с фишками и клетки с выбранными фишками', () => {
  assert.deepEqual(tokenPickCellKeys(VIEWS), ['0,0', '1,0'])
  assert.deepEqual(pickedTokenCellKeys(VIEWS, ['1,0:1']), ['1,0'])
  assert.deepEqual(pickedTokenCellKeys(VIEWS, []), [])
})

test('клик по клетке берёт первую невыбранную фишку', () => {
  assert.equal(tokenKeyForCellClick(VIEWS, [], 1, 0), '1,0:0')
  assert.equal(tokenKeyForCellClick(VIEWS, ['1,0:0'], 1, 0), '1,0:1')
})

test('клик по клетке со всеми выбранными фишками снимает последнюю', () => {
  assert.equal(tokenKeyForCellClick(VIEWS, ['1,0:0', '1,0:1'], 1, 0), '1,0:1')
})

test('клик по клетке без фишек ничего не даёт', () => {
  assert.equal(tokenKeyForCellClick(VIEWS, [], 5, 5), null)
})

test('ссылки на фишки оплаты сохраняют клетку и индекс', () => {
  assert.deepEqual(tokenSpendRefs(VIEWS, ['0,0:0', '1,0:1']), [
    { coord: { q: 0, r: 0 }, tokenIndex: 0 },
    { coord: { q: 1, r: 0 }, tokenIndex: 1 },
  ])
})
