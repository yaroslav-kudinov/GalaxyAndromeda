/**
 * Тексты для игрока живут в `i18n/ui-strings.ts`, а не в разметке компонентов.
 *
 * Проверка работает как храповик: файлы из `UNTRANSLATED_BASELINE` пока могут
 * содержать зашитый текст, все остальные — нет. Перенесли файл в словарь —
 * убрали строку из списка; список умеет только сокращаться, потому что
 * оставшаяся в нём запись без текста тоже роняет проверку.
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { UNTRANSLATED_BASELINE } from '../i18n/untranslated-baseline'
import { scanUiText } from './ui-text-scan'

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function vueFiles(dir: string, out: string[] = []): string[] {
  const full = join(clientRoot, dir)
  if (!existsSync(full)) return out
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) vueFiles(rel, out)
    else if (entry.name.endsWith('.vue')) out.push(rel.split('\\').join('/'))
  }
  return out
}

const files = [...vueFiles('components'), ...vueFiles('pages')]
const baseline = new Set(UNTRANSLATED_BASELINE)

test('в репозитории есть что проверять', () => {
  assert.ok(files.length > 10, `найдено всего ${files.length} компонентов — проверьте пути`)
})

test('новые компоненты берут текст из словаря', () => {
  const offenders: string[] = []
  for (const file of files) {
    if (baseline.has(file)) continue
    const hits = scanUiText(readFileSync(join(clientRoot, file), 'utf8'))
    if (hits.length) {
      const sample = hits
        .slice(0, 3)
        .map((h) => `${file}:${h.line} «${h.text}»`)
        .join('\n    ')
      offenders.push(`${sample}${hits.length > 3 ? `\n    …всего ${hits.length}` : ''}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Текст для игрока зашит в компонент. Перенесите его в i18n/ui-strings.ts:\n    ${offenders.join('\n    ')}`,
  )
})

test('список непереведённых файлов не устарел', () => {
  const stale: string[] = []
  for (const file of UNTRANSLATED_BASELINE) {
    const full = join(clientRoot, file)
    if (!existsSync(full)) {
      stale.push(`${file} — файла больше нет`)
      continue
    }
    if (!scanUiText(readFileSync(full, 'utf8')).length) {
      stale.push(`${file} — текста не осталось, уберите запись из списка`)
    }
  }
  assert.deepEqual(stale, [], `Список в i18n/untranslated-baseline.ts пора сократить:\n    ${stale.join('\n    ')}`)
})

test('в списке нет повторов', () => {
  assert.equal(
    new Set(UNTRANSLATED_BASELINE).size,
    UNTRANSLATED_BASELINE.length,
    'в UNTRANSLATED_BASELINE есть повторяющиеся пути',
  )
})

test('пути в списке записаны единообразно', () => {
  const wrong = UNTRANSLATED_BASELINE.filter(
    (file) => file.includes('\\') || file.startsWith('/') || !file.endsWith('.vue'),
  )
  assert.deepEqual(wrong, [], 'пути пишутся через прямой слэш относительно packages/client')
})
