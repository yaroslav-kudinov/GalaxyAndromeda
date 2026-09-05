import type { FastifyInstance, FastifyRequest } from 'fastify'
import { getPublishedMapDefinition, listPublishedMaps, listPublishedScenarios, getScenarioById } from './db/index.js'

export function registerCatalogRoutes(app: FastifyInstance): void {
  app.get('/catalog/maps', async () => {
    const rows = listPublishedMaps()
    return {
      maps: rows.map((row) => ({
        id: row.id,
        name: row.name,
        playerCount: row.player_count,
      })),
    }
  })

  app.get<{ Params: { id: string } }>('/catalog/maps/:id', async (req, reply) => {
    const map = getPublishedMapDefinition(req.params.id)
    if (!map) return reply.status(404).send({ error: 'Карта не найдена' })
    return { map }
  })

  app.get('/catalog/scenarios', async () => {
    const rows = listPublishedScenarios()
    return {
      scenarios: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        mapId: row.map_id,
      })),
    }
  })

  app.get<{ Params: { id: string } }>('/catalog/scenarios/:id', async (req, reply) => {
    const row = getScenarioById(req.params.id)
    if (!row || !row.published) return reply.status(404).send({ error: 'Сценарий не найден' })
    return { scenario: JSON.parse(row.script_json) }
  })
}

export function readBundledMapsFallback(): Array<{ id: string; name: string; playerCount: number; map: unknown }> {
  // Used when DB empty in dev - client has public/maps/*.json
  return []
}

export function clientIp(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0]!.trim()
  return req.ip
}
