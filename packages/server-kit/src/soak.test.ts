import { afterEach, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './testing/harness.js'
import { runSoak, type SoakResult } from './testing/soak.js'

/**
 * Spec §29.3: 6 clients × 3 rooms × 20 hands in parallel, over real WebSockets, checking that the
 * points add up and that nobody's `seq` stream has a hole in it. §24 wants action → broadcast at
 * p95 < 50 ms; the assertion here is the looser 200 ms so a busy CI box cannot make the suite lie,
 * and the real number is printed either way.
 */
const CLIENTS = 6
const ROOMS = 3
const HANDS = 20

/**
 * `TEST_SERVER_ROOM_OPTIONS` compresses every room timer roughly a hundredfold (a 5 s pause between
 * hands becomes 50 ms), so a soak client legitimately acts far more often per wall-clock second than
 * any human at a real table ever could. The per-connection budget has to be scaled with the clock,
 * or the flood protection — which `gateway.test.ts` covers on its own terms — is what the soak ends
 * up measuring.
 */
const SOAK_GATEWAY = { rateLimitPerSec: 500, rateLimitBurst: 500 }

let ts: TestServer
afterEach(async () => { await ts?.close() })

const players = (): [string, number][] => Array.from({ length: CLIENTS }, (_, i) => [`p${i}`, 200_000])

function report(label: string, r: SoakResult): void {
  const line = [
    `[soak/${label}] hands=${r.hands} (cancelled ${r.cancelledHands}) actions=${r.actions}`,
    `fees=${r.fees} sinks=${r.sinks} botNet=${r.botNet}`,
    `balances ${r.startBalances} → ${r.endBalances}`,
    `seqGaps=${r.seqGaps} resyncs=${r.resyncs}`,
    `p95=${r.p95ActionToBroadcastMs}ms max=${r.maxActionToBroadcastMs}ms`,
    r.tolerated.length > 0 ? `tolerated=${r.tolerated.length}` : '',
  ].filter(Boolean).join(' ')
  console.info(line)
}

/** Assertions every soak makes, whatever the mode. */
function expectHealthy(r: SoakResult): void {
  expect(r.errors).toEqual([])
  expect(r.seqGaps).toBe(0)
  expect(r.resyncs).toBe(0)
  expect(r.hands).toBeGreaterThanOrEqual(ROOMS * HANDS)
  expect(r.actions).toBeGreaterThan(0)
  // §24 target is 50 ms; assert the CI-proof bound and let the log carry the measured value.
  expect(r.p95ActionToBroadcastMs).toBeLessThan(200)
  // Every fee the engine took is a `table_fee` sink row, so the two independent money sources agree.
  expect(ts.repos.sinks.filter((x) => x.kind === 'table_fee').reduce((s, x) => s + x.fee, 0)).toBe(r.fees)
  for (const room of ts.server.rooms.all()) expect(room.carryOverPot).toBe(0)
}

describe('multiplayer soak (§29.3)', () => {
  it("hold'em: 6 clients over 3 rooms play 20 hands each with no seq gaps and no points created or lost", async () => {
    ts = await startTestServer({ players: players(), seed: 20_260_905, gatewayOptions: SOAK_GATEWAY })
    const r = await runSoak(ts, { clients: CLIENTS, rooms: ROOMS, handsPerRoom: HANDS, mode: 'holdem', seed: 1_337 })
    report('holdem', r)
    expectHealthy(r)
    // No bots in a hold'em room and no carry-over pots, so the identity is the plain one: whatever
    // the players no longer hold, the table took as its fee.
    expect(r.botNet).toBe(0)
    expect(r.sinks).toBe(r.fees)
    expect(r.endBalances + r.fees).toBe(r.startBalances)
  }, 90_000)

  it('blind: the same run against one bot per room conserves points across balances, fees and bot nets', async () => {
    ts = await startTestServer({ players: players(), seed: 20_260_905, gatewayOptions: SOAK_GATEWAY })
    const r = await runSoak(ts, { clients: CLIENTS, rooms: ROOMS, handsPerRoom: HANDS, mode: 'blind', seed: 4_242, actionDelayMs: [0, 3] })
    report('blind', r)
    expectHealthy(r)
    // Bots hold a virtual balance no repository ever sees, so their net is the third term; the
    // sinks cover both the table fees and any indivisible carry-over remainder released at shutdown.
    expect(r.endBalances + r.botNet + r.sinks).toBe(r.startBalances)
    expect(r.sinks).toBeGreaterThanOrEqual(r.fees)
  }, 90_000)
})
