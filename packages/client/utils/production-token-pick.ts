/**
 * Ручной выбор фишек ресурсов при постройке кораблей.
 *
 * Чистые функции без зависимости от снимка партии: окно маркера действия
 * подставляет сюда уже посчитанные значения фишек (с учётом карты события).
 */

import type { HexCoord, ResourceTokenDef, TokenSpendRef } from '@galaxy/rules'

/** Фишка региона, как её показывает окно постройки и карта */
export type RegionTokenView = {
  /** Ключ фишки: «q,r:индекс» — как в tokenSpendKey из правил */
  key: string
  coord: HexCoord
  tokenIndex: number
  token: ResourceTokenDef
  /** Действующее значение фишки с учётом модификаторов хода */
  value: number
}

export type RegionTokenCellGroup = {
  cellKey: string
  coord: HexCoord
  tokens: RegionTokenView[]
}

export function tokenPickEntries(views: readonly RegionTokenView[]): TokenPickEntry[] {
  return views.map((view) => ({ key: view.key, type: view.token.type, value: view.value }))
}

/** Фишки по клеткам — так их проще сопоставить с картой */
export function groupTokenViewsByCell(
  views: readonly RegionTokenView[],
): RegionTokenCellGroup[] {
  const groups = new Map<string, RegionTokenCellGroup>()
  for (const view of views) {
    const cellKey = `${view.coord.q},${view.coord.r}`
    let group = groups.get(cellKey)
    if (!group) {
      group = { cellKey, coord: view.coord, tokens: [] }
      groups.set(cellKey, group)
    }
    group.tokens.push(view)
  }
  return [...groups.values()]
}

/** Ключи клеток, на которых есть фишки для выбора */
export function tokenPickCellKeys(views: readonly RegionTokenView[]): string[] {
  return [...new Set(views.map((view) => `${view.coord.q},${view.coord.r}`))]
}

/** Ключи клеток, чьи фишки уже выбраны */
export function pickedTokenCellKeys(
  views: readonly RegionTokenView[],
  selectedKeys: readonly string[],
): string[] {
  const selected = new Set(selectedKeys)
  return [
    ...new Set(
      views
        .filter((view) => selected.has(view.key))
        .map((view) => `${view.coord.q},${view.coord.r}`),
    ),
  ]
}

/**
 * Какую фишку переключить по клику на клетке карты.
 * Берём первую невыбранную; если выбраны все — последнюю, чтобы клик снимал выбор.
 */
export function tokenKeyForCellClick(
  views: readonly RegionTokenView[],
  selectedKeys: readonly string[],
  q: number,
  r: number,
): string | null {
  const onCell = views.filter((view) => view.coord.q === q && view.coord.r === r)
  if (!onCell.length) return null
  const selected = new Set(selectedKeys)
  const free = onCell.find((view) => !selected.has(view.key))
  return (free ?? onCell[onCell.length - 1]!).key
}

/** Ссылки на фишки оплаты для действия постройки */
export function tokenSpendRefs(
  views: readonly RegionTokenView[],
  selectedKeys: readonly string[],
): TokenSpendRef[] {
  const selected = new Set(selectedKeys)
  return views
    .filter((view) => selected.has(view.key))
    .map((view) => ({ coord: view.coord, tokenIndex: view.tokenIndex }))
}

export type TokenPickEntry = {
  /** Ключ фишки: «q,r:индекс» — как в tokenSpendKey из правил */
  key: string
  type: 'credits' | 'production'
  /** Действующее значение фишки с учётом модификаторов хода */
  value: number
}

export type TokenPickTotals = {
  credits: number
  production: number
}

export type TokenPickCoverage = {
  creditsMissing: number
  productionMissing: number
  /** Выбранных фишек хватает на всю заявку */
  covered: boolean
  /** Переплата сверх нужного (фишки тратятся целиком) */
  creditsExtra: number
  productionExtra: number
}

export function tokenPickTotals(
  entries: readonly TokenPickEntry[],
  selectedKeys: readonly string[],
): TokenPickTotals {
  const selected = new Set(selectedKeys)
  let credits = 0
  let production = 0
  for (const entry of entries) {
    if (!selected.has(entry.key)) continue
    if (entry.type === 'credits') credits += entry.value
    else production += entry.value
  }
  return { credits, production }
}

export function tokenPickCoverage(
  totals: TokenPickTotals,
  need: TokenPickTotals,
): TokenPickCoverage {
  const creditsMissing = Math.max(0, need.credits - totals.credits)
  const productionMissing = Math.max(0, need.production - totals.production)
  return {
    creditsMissing,
    productionMissing,
    covered: creditsMissing === 0 && productionMissing === 0,
    creditsExtra: Math.max(0, totals.credits - need.credits),
    productionExtra: Math.max(0, totals.production - need.production),
  }
}

export function toggleTokenKey(
  selectedKeys: readonly string[],
  key: string,
): string[] {
  return selectedKeys.includes(key)
    ? selectedKeys.filter((k) => k !== key)
    : [...selectedKeys, key]
}

/** Убирает из выбора фишки, которых больше нет в регионе (перезарядка, потеря контроля) */
export function pruneTokenKeys(
  entries: readonly TokenPickEntry[],
  selectedKeys: readonly string[],
): string[] {
  const available = new Set(entries.map((e) => e.key))
  return selectedKeys.filter((key) => available.has(key))
}
