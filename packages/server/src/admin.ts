import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  normalizeMapDefinition,
  parseGalaxySave,
  validateMapDefinition,
  type MapDefinition,
} from '@galaxy/rules'
import {
  approveMapSubmission,
  countSubmissionsToday,
  deleteMap,
  insertMapSubmission,
  incrementSubmissionCount,
  listAllMaps,
  listGameLogs,
  getGameLog,
  listMapSubmissions,
  rejectMapSubmission,
  setMapPublished,
  upsertScenario,
  listPublishedScenarios,
} from './db/index.js'
import { clientIp } from './catalog.js'

const MAX_SUBMISSIONS_PER_DAY = Number(process.env.GALAXY_MAX_MAP_SUBMISSIONS_PER_DAY ?? 5)

export function adminToken(): string | null {
  const token = process.env.GALAXY_ADMIN_TOKEN?.trim()
  return token || null
}

export function assertAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const expected = adminToken()
  if (!expected) {
    reply.status(503).send({ error: 'Админка не настроена (GALAXY_ADMIN_TOKEN)' })
    return false
  }
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (token !== expected) {
    reply.status(401).send({ error: 'Неверный токен администратора' })
    return false
  }
  return true
}

export function registerMapSubmitRoutes(app: FastifyInstance): void {
  app.post<{ Body: { nickname?: string; map?: unknown; save?: unknown } }>(
    '/maps/submit',
    async (req, reply) => {
      const ip = clientIp(req)
      if (countSubmissionsToday(ip) >= MAX_SUBMISSIONS_PER_DAY) {
        return reply.status(429).send({ error: 'Превышен лимит заявок на модерацию на сегодня' })
      }
      const nickname = sanitizeNickname(req.body.nickname ?? '')
      if (!nickname) return reply.status(400).send({ error: 'Укажите никнейм' })

      let map: MapDefinition
      try {
        if (req.body.save != null) {
          map = parseGalaxySave(req.body.save).map
        } else if (req.body.map != null) {
          map = req.body.map as MapDefinition
        } else {
          return reply.status(400).send({ error: 'Нужна карта или сохранение' })
        }
        map = normalizeMapDefinition(map)
      } catch {
        return reply.status(400).send({ error: 'Некорректный формат карты' })
      }

      const errors = validateMapDefinition(map)
      if (errors.length) {
        return reply.status(400).send({ error: errors[0], errors })
      }

      incrementSubmissionCount(ip)
      const id = insertMapSubmission(nickname, ip, JSON.stringify(map))
      return { ok: true, submissionId: id, message: 'Заявка отправлена на модерацию' }
    },
  )
}

export function registerAdminRoutes(app: FastifyInstance): void {
  void app.register(async (admin) => {
    admin.addHook('preHandler', async (req, reply) => {
      if (!assertAdmin(req, reply)) return reply
    })

    admin.get('/maps', async () => {
      const rows = listAllMaps()
      return {
        maps: rows.map((row) => ({
          id: row.id,
          name: row.name,
          playerCount: row.player_count,
          source: row.source,
          published: !!row.published,
          sortOrder: row.sort_order,
          map: JSON.parse(row.json),
        })),
      }
    })

    admin.patch<{ Params: { id: string }; Body: { published?: boolean; sortOrder?: number } }>(
      '/maps/:id',
      async (req, reply) => {
        if (req.body.published != null) {
          if (!setMapPublished(req.params.id, req.body.published)) {
            return reply.status(404).send({ error: 'Карта не найдена' })
          }
        }
        return { ok: true }
      },
    )

    admin.delete<{ Params: { id: string } }>('/maps/:id', async (req, reply) => {
      if (!deleteMap(req.params.id)) return reply.status(404).send({ error: 'Карта не найдена' })
      return { ok: true }
    })

    admin.get('/submissions', async (req) => {
      const status = (req.query as { status?: string }).status
      const rows = listMapSubmissions(status)
      return {
        submissions: rows.map((row) => ({
          id: row.id,
          nickname: row.submitter_nickname,
          status: row.status,
          adminNote: row.admin_note,
          createdAt: row.created_at,
          reviewedAt: row.reviewed_at,
          map: JSON.parse(row.map_json),
        })),
      }
    })

    admin.post<{ Params: { id: string }; Body: { note?: string } }>(
      '/submissions/:id/approve',
      async (req, reply) => {
        const id = Number(req.params.id)
        if (!approveMapSubmission(id, req.body.note)) {
          return reply.status(400).send({ error: 'Заявка не найдена или уже обработана' })
        }
        return { ok: true }
      },
    )

    admin.post<{ Params: { id: string }; Body: { note: string } }>(
      '/submissions/:id/reject',
      async (req, reply) => {
        const id = Number(req.params.id)
        if (!req.body.note?.trim()) {
          return reply.status(400).send({ error: 'Укажите причину отклонения' })
        }
        if (!rejectMapSubmission(id, req.body.note.trim())) {
          return reply.status(400).send({ error: 'Заявка не найдена или уже обработана' })
        }
        return { ok: true }
      },
    )

    admin.get('/scenarios', async () => {
      const rows = listPublishedScenarios()
      return { scenarios: rows.map((r) => ({ id: r.id, name: r.name, mapId: r.map_id })) }
    })

    admin.post<{
      Body: {
        id: string
        name: string
        description?: string
        scriptJson: string
        mapId: string
        published?: boolean
      }
    }>('/scenarios', async (req, reply) => {
      if (!req.body.id || !req.body.name || !req.body.scriptJson || !req.body.mapId) {
        return reply.status(400).send({ error: 'Неполные данные сценария' })
      }
      upsertScenario({
        id: req.body.id,
        name: req.body.name,
        description: req.body.description ?? '',
        scriptJson: req.body.scriptJson,
        mapId: req.body.mapId,
        published: req.body.published,
      })
      return { ok: true }
    })

    admin.get('/game-logs', async (req) => {
      const q = req.query as { limit?: string; offset?: string }
      const limit = Math.min(Number(q.limit ?? 50), 200)
      const offset = Number(q.offset ?? 0)
      return { logs: listGameLogs(limit, offset) }
    })

    admin.get<{ Params: { id: string } }>('/game-logs/:id', async (req, reply) => {
      const log = getGameLog(Number(req.params.id))
      if (!log) return reply.status(404).send({ error: 'Лог не найден' })
      return {
        log: {
          ...log,
          players: JSON.parse(log.players_json),
          eventLog: JSON.parse(log.event_log_json),
        },
      }
    })
  }, { prefix: '/admin' })
}

const NICKNAME_MAX = 32
const PROFANITY = ['fuck', 'shit', 'хуй', 'бля', 'сука', 'пизд']

export function sanitizeNickname(raw: string): string {
  let name = raw.trim().replace(/[\u0000-\u001f\u007f<>]/g, '')
  name = name.replace(/\s+/g, ' ')
  if (name.length > NICKNAME_MAX) name = name.slice(0, NICKNAME_MAX)
  const lower = name.toLowerCase()
  if (PROFANITY.some((w) => lower.includes(w))) return ''
  return name
}

export function sanitizePlayerName(raw: string | undefined, fallback: string): string {
  const cleaned = sanitizeNickname(raw ?? '')
  return cleaned || fallback
}
