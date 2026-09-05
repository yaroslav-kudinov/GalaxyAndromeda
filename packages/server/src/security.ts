import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import helmet from '@fastify/helmet'

const roomCreatesByIp = new Map<string, number>()
const MAX_ROOMS_PER_IP = Number(process.env.GALAXY_MAX_ROOMS_PER_IP ?? 10)

export function registerSecurityPlugins(app: FastifyInstance): void {
  void app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })

  void app.register(rateLimit, {
    global: true,
    max: Number(process.env.GALAXY_RATE_LIMIT_MAX ?? 200),
    timeWindow: '1 minute',
  })
}

export function canCreateRoom(ip: string): boolean {
  const count = roomCreatesByIp.get(ip) ?? 0
  return count < MAX_ROOMS_PER_IP
}

export function trackRoomCreate(ip: string): void {
  roomCreatesByIp.set(ip, (roomCreatesByIp.get(ip) ?? 0) + 1)
}

export function untrackRoomCreate(ip: string): void {
  const count = roomCreatesByIp.get(ip) ?? 0
  if (count <= 1) roomCreatesByIp.delete(ip)
  else roomCreatesByIp.set(ip, count - 1)
}
