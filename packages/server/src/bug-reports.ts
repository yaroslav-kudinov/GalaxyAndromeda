/**
 * Временное хранилище баг-репортов на диске сервера.
 * Репорты удаляются через 60 дней (проверка при старте, по таймеру и при создании).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'

export const BUG_REPORT_TTL_MS = 60 * 24 * 60 * 60 * 1000
export const BUG_REPORT_MAX_DESCRIPTION = 4000
export const BUG_REPORT_MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export interface BugReportMeta {
  id: string
  createdAt: string
  expiresAt: string
  description: string
  playerId?: string
  playerName?: string
  roomId?: string
  userAgent?: string
  hasScreenshot: boolean
  screenshotFile?: string
}

export interface CreateBugReportInput {
  description: string
  screenshotBase64?: string
  screenshotMime?: string
  playerId?: string
  playerName?: string
  roomId?: string
  userAgent?: string
}

function repoRoot(): string {
  return resolve(fileURLToPath(new URL('../../..', import.meta.url)))
}

export const bugReportsDir = process.env.BUG_REPORTS_DIR
  ? resolve(process.env.BUG_REPORTS_DIR)
  : join(repoRoot(), '.bug-reports')

function ensureStore(): void {
  if (!existsSync(bugReportsDir)) mkdirSync(bugReportsDir, { recursive: true })
}

function reportDir(id: string): string {
  return join(bugReportsDir, id)
}

function isExpired(meta: BugReportMeta, now = Date.now()): boolean {
  const expires = Date.parse(meta.expiresAt)
  if (!Number.isFinite(expires)) return true
  return expires <= now
}

function readMeta(id: string): BugReportMeta | null {
  const path = join(reportDir(id), 'meta.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as BugReportMeta
  } catch {
    return null
  }
}

export function purgeExpiredBugReports(now = Date.now()): number {
  ensureStore()
  let removed = 0
  for (const name of readdirSync(bugReportsDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const id = name.name
    const meta = readMeta(id)
    if (!meta || isExpired(meta, now)) {
      rmSync(reportDir(id), { recursive: true, force: true })
      removed++
    }
  }
  return removed
}

function stripDataUrl(base64: string): { mime?: string; data: string } {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(base64.trim())
  if (match) return { mime: match[1], data: match[2]! }
  return { data: base64.trim() }
}

export function createBugReport(input: CreateBugReportInput): BugReportMeta {
  const description = input.description?.trim() ?? ''
  if (!description) throw new Error('Опишите проблему')
  if (description.length > BUG_REPORT_MAX_DESCRIPTION) {
    throw new Error(`Описание слишком длинное (макс. ${BUG_REPORT_MAX_DESCRIPTION} символов)`)
  }

  purgeExpiredBugReports()
  ensureStore()

  const id = randomUUID()
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + BUG_REPORT_TTL_MS)
  const dir = reportDir(id)
  mkdirSync(dir, { recursive: true })

  let hasScreenshot = false
  let screenshotFile: string | undefined

  if (input.screenshotBase64?.trim()) {
    const parsed = stripDataUrl(input.screenshotBase64)
    const mime = (input.screenshotMime ?? parsed.mime ?? 'image/png').toLowerCase()
    const ext = MIME_TO_EXT[mime]
    if (!ext) throw new Error('Поддерживаются скриншоты PNG, JPEG, WebP или GIF')
    let buffer: Buffer
    try {
      buffer = Buffer.from(parsed.data, 'base64')
    } catch {
      throw new Error('Некорректный файл скриншота')
    }
    if (!buffer.length) throw new Error('Пустой скриншот')
    if (buffer.length > BUG_REPORT_MAX_SCREENSHOT_BYTES) {
      throw new Error('Скриншот слишком большой (макс. 5 МБ)')
    }
    screenshotFile = `screenshot.${ext}`
    writeFileSync(join(dir, screenshotFile), buffer)
    hasScreenshot = true
  }

  const meta: BugReportMeta = {
    id,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    description,
    playerId: input.playerId?.trim() || undefined,
    playerName: input.playerName?.trim() || undefined,
    roomId: input.roomId?.trim() || undefined,
    userAgent: input.userAgent?.trim() || undefined,
    hasScreenshot,
    screenshotFile,
  }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return meta
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null

export function startBugReportCleanup(): void {
  ensureStore()
  const removed = purgeExpiredBugReports()
  if (removed > 0) {
    console.log(`@galaxy/server bug-reports: удалено просроченных: ${removed}`)
  }
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    try {
      purgeExpiredBugReports()
    } catch (err) {
      console.error('@galaxy/server bug-reports cleanup failed', err)
    }
  }, 60 * 60 * 1000)
  cleanupTimer.unref?.()
}

export function registerBugReportRoutes(app: FastifyInstance): void {
  startBugReportCleanup()

  app.post<{
    Body: {
      description?: string
      screenshotBase64?: string
      screenshotMime?: string
      playerId?: string
      playerName?: string
      roomId?: string
    }
  }>('/bug-reports', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    try {
      const body = req.body ?? {}
      const meta = createBugReport({
        description: body.description ?? '',
        screenshotBase64: body.screenshotBase64,
        screenshotMime: body.screenshotMime,
        playerId: body.playerId,
        playerName: body.playerName,
        roomId: body.roomId,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      })
      return {
        ok: true,
        id: meta.id,
        expiresAt: meta.expiresAt,
        hasScreenshot: meta.hasScreenshot,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить репорт'
      return reply.code(400).send({ error: message })
    }
  })
}
