import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { seededRng } from '@bp/core'
import type { DomainEvent } from '../domain-events.js'
import type { GatewayOptions } from '../gateway/gateway.js'
import { silentLogger } from '../infra/logger.js'
import { createMemoryRepositories, type MemoryRepositories } from '../memory-repositories.js'
import type { RoomOptions } from '../room/types.js'
import { createGameServer, type GameServer } from '../server.js'

export interface TestServer {
  url: string
  repos: MemoryRepositories
  server: GameServer
  http: Server
  domainEvents: DomainEvent[]
  close(): Promise<void>
}

export const TEST_SERVER_ROOM_OPTIONS: Partial<RoomOptions> = {
  handIntervalMs: 50,
  revealDelayMs: 5,
  botDelayMs: [5, 5],
  reconnectWindowMs: 300,
  spectatorGraceMs: 300,
  emptyRoomCloseMs: 200,
  carryOverReleaseMs: 100,
  turnTimerMsOverride: 2_000,
}

export async function startTestServer(opts: { players?: [id: string, balance: number][]; roomOptions?: Partial<RoomOptions>; gatewayOptions?: Partial<GatewayOptions>; seed?: number } = {}): Promise<TestServer> {
  const repos = createMemoryRepositories()
  for (const [id, balance] of opts.players ?? [['a', 100_000], ['b', 100_000], ['c', 100_000]]) repos.addPlayer(id, id.toUpperCase(), balance)
  const domainEvents: DomainEvent[] = []
  const server = createGameServer({
    repos,
    resolver: {
      async fromToken(token) {
        const id = token.startsWith('tok:') ? token.slice(4) : ''
        const rec = await repos.players.findById(id)
        return rec ? { playerId: rec.playerId, displayName: rec.displayName, isBot: false } : null
      },
    },
    rng: seededRng(opts.seed ?? 42),
    log: silentLogger,
    roomOptions: { ...TEST_SERVER_ROOM_OPTIONS, ...opts.roomOptions },
    gatewayOptions: { heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 120_000, ...opts.gatewayOptions },
    onDomainEvent: (e) => domainEvents.push(e),
  })
  const http = createServer((_req, res) => { res.statusCode = 404; res.end() })
  http.on('upgrade', (req, socket, head) => server.handleUpgrade(req, socket, head))
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const port = (http.address() as AddressInfo).port
  return {
    url: `ws://127.0.0.1:${port}/ws`,
    repos,
    server,
    http,
    domainEvents,
    async close() {
      await server.shutdown('test end')
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}
