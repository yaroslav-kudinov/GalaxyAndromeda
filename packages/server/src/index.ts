import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { registerHttpRoutes, restoreRoomsFromDisk } from './room.js'
import { devRoomsDir, roomPersistenceEnabled } from './room-persistence.js'

const PORT = Number(process.env.PORT ?? 3001)
const HOST = process.env.HOST ?? '0.0.0.0'

const app = Fastify({
  logger: process.env.LOG_LEVEL ? { level: process.env.LOG_LEVEL } : false,
})
await app.register(websocket)

if (roomPersistenceEnabled) {
  const restoredRooms = restoreRoomsFromDisk()
  console.log(`@galaxy/server dev-rooms: ${devRoomsDir} (восстановлено комнат: ${restoredRooms})`)
}

registerHttpRoutes(app)

app.register(async (instance) => {
  instance.get('/ws', { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: 'connected', message: 'Galaxy Andromeda game server' }))
    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      socket.send(JSON.stringify({ type: 'echo', data: raw.toString() }))
    })
  })
})

try {
  await app.listen({ port: PORT, host: HOST })
  console.log(`@galaxy/server listening on http://${HOST}:${PORT}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
