/**
 * Поиск русского текста, зашитого прямо в компонент.
 *
 * Тексты для игрока должны лежать в `i18n/ui-strings.ts`: так их можно
 * вычитывать одним файлом, сверять с глоссарием и позже озвучивать по ключу.
 * Эта функция находит то, что ещё не переехало, и используется проверкой в
 * тестах — поэтому она чистая и не знает про файловую систему.
 */

export type UiTextHit = {
  /** Номер строки в исходном файле, начиная с 1 */
  line: number
  /** Найденный фрагмент, обрезанный до читаемой длины */
  text: string
}

const MAX_SNIPPET = 60

/** Заменяет кусок текста пробелами, сохраняя переводы строк и нумерацию */
function blank(source: string, pattern: RegExp): string {
  return source.replace(pattern, (match) => match.replace(/[^\n]/g, ' '))
}

/**
 * Комментарии и стили не показываются игроку: пояснения на русском в коде —
 * это хорошо, и ругаться на них не нужно.
 */
function stripNonVisible(source: string): string {
  let out = blank(source, /<style[\s\S]*?<\/style>/g)
  out = blank(out, /<!--[\s\S]*?-->/g)
  out = blank(out, /\/\*[\s\S]*?\*\//g)
  out = blank(out, /(^|[^:])\/\/[^\n]*/g)
  return out
}

export function scanUiText(source: string): UiTextHit[] {
  const visible = stripNonVisible(source)
  const hits: UiTextHit[] = []

  visible.split('\n').forEach((line, index) => {
    // Кавычки обрывают фрагмент: в отчёт попадает сама фраза, а не хвост строки
    const matches = line.match(/[А-ЯЁа-яё][^<>{}\n'"`]*/g)
    if (!matches) return
    for (const raw of matches) {
      const text = raw.trim()
      // Одиночная буква — это, как правило, обозначение вроде «ч» или «с»
      if (text.length < 2) continue
      hits.push({
        line: index + 1,
        text: text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET)}…` : text,
      })
    }
  })

  return hits
}

export function hasUiText(source: string): boolean {
  return scanUiText(source).length > 0
}
