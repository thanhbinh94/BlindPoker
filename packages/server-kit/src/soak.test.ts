import { afterEach, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './testing/harness.js'
import { runSoak, seqVerdict, type SoakResult } from './testing/soak.js'

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
    `[soak/${label}] hands=${r.hands} [${r.handsPerRoomSeen.join('/')}] (cancelled ${r.cancelledHands}) samples=${r.latencySamples}`,
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
  // §29.3 asks for 20 hands in *each* of the three rooms; the aggregate above would be satisfied by
  // one room playing 60 and two stalling, so pin the distribution as well.
  expect(r.handsPerRoomSeen).toHaveLength(ROOMS)
  expect(Math.min(...r.handsPerRoomSeen)).toBeGreaterThanOrEqual(HANDS)
  expect(r.latencySamples).toBeGreaterThan(0)
  // §24 target is 50 ms; assert the CI-proof bound and let the log carry the measured value.
  expect(r.p95ActionToBroadcastMs).toBeLessThan(200)
  // A cancelled hand takes no rake. The totals identity cannot catch a violation on its own — a fee
  // wrongly charged would land in `fees`, in `sinks` and in the balance deduction alike — so the
  // cancelled hands (there are usually one or two, from the hand in flight at shutdown) are checked
  // directly.
  expect(r.cancelledFees).toBe(0)
  // Every fee the engine took is a `table_fee` sink row, so the two independent money sources agree.
  expect(ts.repos.sinks.filter((x) => x.kind === 'table_fee').reduce((s, x) => s + x.fee, 0)).toBe(r.fees)
  // The driver knowingly races the room's state machine, but only a handful of times; a seating
  // regression turning every re-buy into a `SEAT_TAKEN` must not be able to hide in here.
  expect(r.tolerated.length).toBeLessThan(r.hands)
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
    // Bots hold a virtual balance no repository ever sees, so their net is the third term. Blind takes no table fee
    // (plan 27 D1), so the only sink left is an indivisible carry-over remainder released at shutdown.
    expect(r.endBalances + r.botNet + r.sinks).toBe(r.startBalances)
    expect(r.fees).toBe(0)
  }, 90_000)
})

/**
 * A healthy soak never takes the gap branch, so `seqGaps === 0` alone would still pass if the
 * detector stopped detecting. This is its positive control.
 */
describe('the seq rule the soak clients apply', () => {
  it('accepts the next frame, ignores one the snapshot already covered, and calls a hole a gap', () => {
    expect(seqVerdict(-1, 7)).toBe('apply') // the first frame: nothing to compare against
    expect(seqVerdict(7, 8)).toBe('apply')
    expect(seqVerdict(7, 7)).toBe('duplicate')
    expect(seqVerdict(7, 5)).toBe('duplicate') // arrived behind a RESYNC snapshot
    expect(seqVerdict(7, 9)).toBe('gap')
    expect(seqVerdict(7, 99)).toBe('gap')
  })
})
