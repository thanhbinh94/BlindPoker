import type { RoomConfig } from '@bp/core'
import { afterEach, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './testing/harness.js'
import { TestClient } from './testing/test-client.js'

const BLIND: RoomConfig = { name: 'B', mode: 'blind', maxPlayers: 4, isPrivate: false, turnTimerSec: 10, autoStart: true, blind: { holeCards: 3, decisionMode: 'playOrFold', fixedWager: 1000, botCount: 1 } }
const HOLDEM: RoomConfig = { name: 'H', mode: 'holdem', maxPlayers: 4, isPrivate: false, turnTimerSec: 15, autoStart: true, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }

let ts: TestServer
afterEach(async () => { await ts?.close() })

/** Plays until `hands` HAND_COMPLETE events have been seen, following a simple policy; returns seq gaps found. */
async function autoplay(c: TestClient, mySeat: number, hands: number, policy: (kinds: string[], i: number) => string): Promise<{ gaps: number; completed: number }> {
  let completed = 0, gaps = 0, lastSeq = -1, i = 0
  while (completed < hands) {
    const m = await c.next('GAME_EVENT', () => true, 8000)
    if (lastSeq >= 0 && m.seq !== lastSeq + 1 && m.seq <= lastSeq) gaps++
    lastSeq = m.seq
    const e = m.event
    if (e.type === 'HAND_COMPLETE') completed++
    const myTurn = (e.type === 'TURN_CHANGED' && e.seat === mySeat) || (e.type === 'DECISION_PHASE' && e.seats.includes(mySeat))
    if (myTurn) {
      const kinds = e.type === 'TURN_CHANGED' ? e.legal.kinds : ['play', 'fold']
      c.send({ t: 'ACTION', reqId: `q${i++}`, baseSeq: m.seq, action: { kind: policy(kinds, i) } })
    }
  }
  return { gaps, completed }
}

describe('multiplayer soak', () => {
  it('two rooms, six clients, ten hands each: no seq regressions and points are conserved', async () => {
    ts = await startTestServer({ players: [['a', 1e5], ['b', 1e5], ['c', 1e5], ['d', 1e5], ['e', 1e5], ['f', 1e5]], roomOptions: { turnTimerMsOverride: 4000 } })
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const clients = await Promise.all(ids.map(async (id) => { const c = await TestClient.connect(ts.url); await c.hello(`tok:${id}`); return c }))
    const [a, b, c, d, e, f] = clients as [TestClient, TestClient, TestClient, TestClient, TestClient, TestClient]

    a.send({ t: 'CREATE_ROOM', config: BLIND })
    const r1 = await a.next('ROOM_SNAPSHOT')
    d.send({ t: 'CREATE_ROOM', config: HOLDEM })
    const r2 = await d.next('ROOM_SNAPSHOT')
    for (const [cl, code] of [[b, r1.room.code], [c, r1.room.code], [e, r2.room.code], [f, r2.room.code]] as [TestClient, string][]) {
      cl.send({ t: 'JOIN_ROOM', code })
      await cl.next('ROOM_SNAPSHOT')
    }
    const seat = async (cl: TestClient, s: number, buyIn?: number) => { cl.send({ t: 'SIT_DOWN', seat: s, buyIn }); cl.send({ t: 'READY', ready: true }) }
    await seat(a, 0); await seat(b, 1); await seat(c, 2)
    await seat(d, 0, 10_000); await seat(e, 1, 10_000); await seat(f, 2, 10_000)

    const passive = (kinds: string[]) => (kinds.includes('check') ? 'check' : kinds.includes('call') ? 'call' : kinds.includes('play') ? 'play' : 'fold')
    const mixed = (kinds: string[], i: number) => (i % 3 === 0 && kinds.includes('fold') ? 'fold' : passive(kinds))
    const results = await Promise.all([
      autoplay(a, 0, 10, passive), autoplay(b, 1, 10, mixed), autoplay(c, 2, 10, passive),
      autoplay(d, 0, 10, passive), autoplay(e, 1, 10, mixed), autoplay(f, 2, 10, passive),
    ])
    for (const r of results) expect(r.gaps).toBe(0)

    await ts.server.shutdown('soak end') // cashes out hold'em stacks and settles carry-over
    for (const cl of clients) await cl.closed
    const balances = await Promise.all(ids.map((id) => ts.repos.balances.get(id)))
    const fees = ts.repos.hands.reduce((s, h) => s + h.fee, 0)
    const botNet = ts.repos.hands.flatMap((h) => h.players).filter((p) => p.isBot).reduce((s, p) => s + p.net, 0)
    const sinks = ts.repos.sinks.reduce((s, x) => s + x.fee, 0)
    // every fee the engine took is a table_fee sink row; carry_over sinks are pot remainders
    expect(ts.repos.sinks.filter((x) => x.kind === 'table_fee').reduce((s, x) => s + x.fee, 0)).toBe(fees)
    // Σ human balances + bot nets + Σ sinks === the points everyone started with (no live carry-over
    // or table stacks remain: shutdown released both).
    expect(balances.reduce((s, x) => s + x, 0) + sinks + botNet).toBe(600_000)
    for (const room of ts.server.rooms.all()) expect(room.carryOverPot).toBe(0)
    expect(ts.repos.hands.length).toBeGreaterThanOrEqual(20)
  }, 60_000)
})
