import type { GameSnapshot, HexCoord, TokenSpendRef } from '@galaxy/rules'
import {
  getEffectiveTokenValue,
  getOwnedFaceUpTokenOptions,
  hexKey,
  nextProductionMarkerExpandCost,
  productionMarkerLimitForPlayer,
  tokenSpendKey,
  validateBuyProductionMarker,
} from '@galaxy/rules'

export function useProductionMarkerBuyPick(
  snapshot: Ref<GameSnapshot | null>,
  playerId: Ref<string>,
) {
  const active = ref(false)
  const selected = ref<TokenSpendRef[]>([])
  const error = ref<string | null>(null)

  const cost = computed(() => {
    if (!snapshot.value) return null
    return nextProductionMarkerExpandCost(productionMarkerLimitForPlayer(snapshot.value, playerId.value))
  })

  const options = computed(() => {
    if (!snapshot.value || !active.value) return []
    return getOwnedFaceUpTokenOptions(snapshot.value, playerId.value)
  })

  const selectedKeys = computed(() =>
    new Set(selected.value.map((ref) => tokenSpendKey(ref.coord, ref.tokenIndex))),
  )

  const paid = computed(() => {
    if (!snapshot.value) return { credits: 0, production: 0 }
    let credits = 0
    let production = 0
    for (const ref of selected.value) {
      const opt = options.value.find(
        (o) => o.coord.q === ref.coord.q && o.coord.r === ref.coord.r && o.tokenIndex === ref.tokenIndex,
      )
      if (!opt) continue
      const value = getEffectiveTokenValue(snapshot.value, opt.token.value)
      if (opt.token.type === 'credits') credits += value
      else production += value
    }
    return { credits, production }
  })

  const reachableKeys = computed(() => {
    if (!active.value) return [] as string[]
    return [...new Set(options.value.map((o) => hexKey(o.coord.q, o.coord.r)))]
  })

  const destinationKeys = computed(() =>
    selected.value.map((ref) => hexKey(ref.coord.q, ref.coord.r)),
  )

  const bannerText = computed(() => {
    if (!active.value || !cost.value) return ''
    const leftC = Math.max(0, cost.value.credits - paid.value.credits)
    const leftP = Math.max(0, cost.value.production - paid.value.production)
    if (leftC <= 0 && leftP <= 0) return 'Сумма набрана — подтвердите покупку маркера производства'
    return `Кликните свои лицевые фишки: ещё ₡ ${leftC} и ⚙ ${leftP}`
  })

  const canConfirm = computed(() => {
    if (!snapshot.value || !cost.value || !selected.value.length) return false
    return validateBuyProductionMarker(snapshot.value, playerId.value, selected.value).length === 0
  })

  function reset() {
    active.value = false
    selected.value = []
    error.value = null
  }

  function start() {
    selected.value = []
    error.value = null
    active.value = true
  }

  function cancel() {
    reset()
  }

  function handleMapSelect(q: number, r: number): boolean {
    if (!active.value || !snapshot.value) return false
    const cellOpts = options.value.filter((o) => o.coord.q === q && o.coord.r === r)
    if (!cellOpts.length) {
      error.value = 'Нет вашей лицевой фишки на этой клетке'
      return true
    }
    const next = cellOpts.find((o) => !selectedKeys.value.has(o.key)) ?? cellOpts[0]!
    const key = next.key
    if (selectedKeys.value.has(key)) {
      selected.value = selected.value.filter((ref) => tokenSpendKey(ref.coord, ref.tokenIndex) !== key)
      error.value = null
      return true
    }
    const need = cost.value
    if (need) {
      if (next.token.type === 'credits' && paid.value.credits >= need.credits) {
        error.value = 'Кредиты уже набраны — кликните фишку производства'
        return true
      }
      if (next.token.type === 'production' && paid.value.production >= need.production) {
        error.value = 'Производство уже набрано — кликните фишку кредитов'
        return true
      }
    }
    selected.value = [...selected.value, { coord: next.coord, tokenIndex: next.tokenIndex }]
    error.value = null
    return true
  }

  function tryConfirm(): TokenSpendRef[] | null {
    if (!snapshot.value) return null
    const errors = validateBuyProductionMarker(snapshot.value, playerId.value, selected.value)
    if (errors.length) {
      error.value = errors[0] ?? null
      return null
    }
    const tokens = [...selected.value]
    reset()
    return tokens
  }

  function handleCoord(_coord: HexCoord) {
    return handleMapSelect(_coord.q, _coord.r)
  }

  return {
    active,
    error,
    bannerText,
    reachableKeys,
    destinationKeys,
    canConfirm,
    cost,
    paid,
    start,
    cancel,
    handleMapSelect,
    tryConfirm,
    handleCoord,
  }
}
