import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

/** Каталог статики Nuxt (`nuxt generate` → `.output/public`). */
export function resolveClientStaticDir(): string | null {
  const fromEnv = process.env.CLIENT_STATIC_DIR?.trim()
  if (fromEnv) {
    const abs = resolve(fromEnv)
    if (existsSync(join(abs, '200.html')) || existsSync(join(abs, 'index.html'))) return abs
  }

  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '../../client/.output/public'),
    resolve(here, '../../../client/.output/public'),
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, '200.html')) || existsSync(join(dir, 'index.html'))) return dir
  }
  return null
}

/** Отдаёт собранный клиент и SPA-fallback для маршрутов Nuxt. */
export async function registerClientStatic(app: FastifyInstance): Promise<boolean> {
  const root = resolveClientStaticDir()
  if (!root) {
    console.warn(
      '@galaxy/server: статика клиента не найдена — задайте CLIENT_STATIC_DIR или соберите client (`nuxt generate`)',
    )
    return false
  }

  const spaFallback = existsSync(join(root, '200.html')) ? '200.html' : 'index.html'

  await app.register(fastifyStatic, {
    root,
  })

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? req.url
    if (path.startsWith('/api')) {
      reply.code(404).send({ error: 'Not found' })
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      reply.code(404).send({ error: 'Not found' })
      return
    }
    reply.sendFile(spaFallback)
  })

  console.log(`@galaxy/server static: ${root}`)
  return true
}
