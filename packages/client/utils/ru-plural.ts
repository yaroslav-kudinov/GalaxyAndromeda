/**
 * Русские формы числа: «1 центр», «2 центра», «5 центров».
 *
 * Нужна в текстах для игрока: счётчики в интерфейсе постоянно подставляют
 * число в фразу, а «осталось 2 центр власти» читается как ошибка.
 */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(count))
  const lastTwo = n % 100
  // Одиннадцать–четырнадцать всегда берут форму множественного числа
  if (lastTwo >= 11 && lastTwo <= 14) return many
  const last = n % 10
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}
