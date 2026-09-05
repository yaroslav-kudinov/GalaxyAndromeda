import type { FastifyInstance } from 'fastify'

export const maintenanceMode = (): boolean =>
  process.env.GALAXY_MAINTENANCE === '1' || process.env.GALAXY_MAINTENANCE === 'true'

export function registerMaintenanceHook(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!maintenanceMode()) return
    const path = req.url.split('?')[0] ?? req.url
    if (path === '/health' || path === '/api/health') return
    return reply.status(503).send({
      error: 'Сервер на техническом обслуживании. Попробуйте позже.',
      maintenance: true,
    })
  })
}

export const APP_VERSION = process.env.GALAXY_APP_VERSION ?? '0.1.0'
