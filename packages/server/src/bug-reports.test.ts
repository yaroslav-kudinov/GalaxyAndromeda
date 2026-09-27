import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

// Каталог хранилища читается при загрузке модуля — задаём его до импорта.
const dir = mkdtempSync(join(tmpdir(), 'galaxy-bug-reports-'))
process.env.BUG_REPORTS_DIR = dir
const {
  createBugReport,
  deleteBugReport,
  isBugReportId,
  listBugReports,
  readBugReportScreenshot,
} = await import('./bug-reports.js')

after(() => rmSync(dir, { recursive: true, force: true }))

/** PNG 1×1. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('баг-репорты в админке', () => {
  it('список — новые сверху, со скриншотом; удалённого больше нет', async () => {
    const first = createBugReport({ description: 'Первый', playerName: 'Игрок' })
    // Время создания — с точностью до миллисекунды: разводим репорты, чтобы порядок был виден.
    await new Promise((done) => setTimeout(done, 5))
    const second = createBugReport({ description: 'Второй', screenshotBase64: PNG, screenshotMime: 'image/png' })

    const list = listBugReports()
    assert.deepEqual(list.map((report) => report.id), [second.id, first.id])

    const shot = readBugReportScreenshot(second.id)
    assert.equal(shot?.mime, 'image/png')
    assert.ok((shot?.data.length ?? 0) > 0)
    assert.equal(readBugReportScreenshot(first.id), null)

    assert.equal(deleteBugReport(first.id), true)
    assert.deepEqual(listBugReports().map((report) => report.id), [second.id])
    assert.equal(deleteBugReport(first.id), false)
  })

  it('чужой путь вместо идентификатора не принимается', () => {
    assert.equal(isBugReportId('../galaxy.db'), false)
    assert.equal(readBugReportScreenshot('../../etc'), null)
    assert.equal(deleteBugReport('..'), false)
  })
})
