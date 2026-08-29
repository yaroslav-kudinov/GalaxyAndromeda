import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { bugReportsDir, registerBugReportRoutes } from './bug-reports.js'
import { registerHttpRoutes, restoreRoomsFromDisk } from './room.js'
import { devRoomsDir, roomPersistenceEnabled } from './room-persistence.js'
import { registerClientStatic } from './static.js'

const PORT = Number(process.env.PORT ?? 3001)
const HOST = process.env.HOST ?? '0.0.0.0'

const app = Fastify({
  logger: process.env.LOG_LEVEL ? { level: process.env.LOG_LEVEL } : false,
})

if (roomPersistenceEnabled) {
  const restoredRooms = restoreRoomsFromDisk()
  console.log(`@galaxy/server dev-rooms: ${devRoomsDir} (восстановлено комнат: ${restoredRooms})`)
}

await app.register(async (api) => {
  await api.register(websocket)
  registerHttpRoutes(api)
  registerBugReportRoutes(api)

  api.get('/ws', { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: 'connected', message: 'Galaxy Andromeda game server' }))
    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      socket.send(JSON.stringify({ type: 'echo', data: raw.toString() }))
    })
  })
}, { prefix: '/api' })

console.log(`@galaxy/server bug-reports: ${bugReportsDir} (хранение 60 дней)`)

/** Проба для Railway и балансировщиков (основной API — `/api/health`). */
app.get('/health', async () => ({ ok: true, service: '@galaxy/server' }))

await registerClientStatic(app)

try {
  await app.listen({ port: PORT, host: HOST })
  console.log(`@galaxy/server listening on http://${HOST}:${PORT}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
