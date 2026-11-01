import { describe, expect, it } from 'vitest'
import { FakeAudioContext, FakeBufferSource, FakeCompressor, FakeConvolver, FakeGain, FakeParam } from './fake-audio.js'
import { MASTER_GAIN, STINGER_IDS, STINGER_SECONDS, createMaster, scheduleStinger, type StingerId } from './stingers.js'

const WHEN = 0.75

const render = (id: StingerId, when = WHEN) => {
  const fake = new FakeAudioContext()
  const out = fake.createGain()
  const len = scheduleStinger(fake.asContext(), out as unknown as AudioNode, id, when)
  return { fake, out, len }
}

/** Every automated parameter of every node the render made. */
const params = (fake: FakeAudioContext): FakeParam[] =>
  fake.nodes.flatMap((n) => Object.values(n).filter((v): v is FakeParam => v instanceof FakeParam))

describe('the stingers', () => {
  it('lists the seven ids with the plan’s lengths', () => {
    expect(STINGER_IDS).toEqual([
      'entrance.god',
      'entrance.demigod',
      'entrance.godslayer',
      'moment.ascend',
      'moment.demigod',
      'moment.godslain',
      'moment.jackpot',
    ])
    expect(STINGER_SECONDS).toEqual({
      'entrance.god': 3.5,
      'entrance.demigod': 3.0,
      'entrance.godslayer': 4.0,
      'moment.ascend': 2.5,
      'moment.demigod': 2.0,
      'moment.godslain': 2.5,
      'moment.jackpot': 2.0,
    })
  })

  it.each(STINGER_IDS)('every stinger returns its table length (%s)', (id) => {
    expect(render(id).len).toBe(STINGER_SECONDS[id])
  })

  it.each(STINGER_IDS)('every voice stops by the stinger’s end (%s)', (id) => {
    const { fake } = render(id)
    const sources = fake.sources()
    expect(sources.length).toBeGreaterThan(3)
    for (const src of sources) {
      expect(src.startedAt).not.toBeNull()
      expect(src.stoppedAt).not.toBeNull()
      expect(src.startedAt!).toBeGreaterThanOrEqual(WHEN)
      expect(src.stoppedAt!).toBeGreaterThan(src.startedAt!)
      // the last 150 ms are silent: nothing is even running then
      expect(src.stoppedAt!).toBeLessThanOrEqual(WHEN + STINGER_SECONDS[id] - 0.15 + 1e-9)
    }
  })

  it.each(STINGER_IDS)('every stinger reaches the master’s input (%s)', (id) => {
    const { fake, out } = render(id)
    const feeding = fake.feeding(out)
    expect(feeding).toHaveLength(1)
    // The last stage is a fade that is at 0 for the stinger's last 150 ms, so a reverb tail cannot ring past it.
    const bus = feeding[0]
    expect(bus).toBeInstanceOf(FakeGain)
    const events = (bus as FakeGain).gain.events
    const last = events[events.length - 1]!
    expect(last.value).toBe(0)
    expect(last.time).toBeLessThanOrEqual(WHEN + STINGER_SECONDS[id] - 0.15 + 1e-9)
  })

  it.each(STINGER_IDS)('every envelope moves by ramps, forward in time, never by a jump (%s)', (id) => {
    const { fake } = render(id)
    for (const param of params(fake)) {
      const ev = param.events
      for (let i = 1; i < ev.length; i += 1) {
        expect(ev[i]!.time, `${param.owner.kind}.${param.name}`).toBeGreaterThanOrEqual(ev[i - 1]!.time - 1e-12)
        // a gain only ever *holds* with setValueAtTime after its first event; every change is a ramp
        if (param.name === 'gain' && ev[i]!.kind === 'set') expect(ev[i]!.value, `${param.owner.kind}.gain`).toBe(ev[i - 1]!.value)
      }
      // a gain envelope that moves starts from silence
      if (param.name === 'gain' && param.owner.kind === 'gain' && ev.some((e) => e.kind !== 'set') && ev[0]!.value !== 1) {
        expect(ev[0]!.value).toBe(0)
      }
    }
  })

  it.each(STINGER_IDS)('every held note is in tune on the A440 grid (%s)', (id) => {
    const { fake } = render(id)
    for (const osc of fake.oscillators()) {
      const ev = osc.frequency.events
      expect(ev.length, 'each oscillator sets its pitch at its start').toBeGreaterThan(0)
      expect(ev[0]!.time).toBe(osc.startedAt)
      // a sweep (kick, riser) or an LFO (under 20 Hz) is not a note
      if (ev.some((e) => e.kind !== 'set') || ev[0]!.value < 20) continue
      for (const e of ev) {
        const semis = 12 * Math.log2(e.value / 440)
        expect(Math.abs(semis - Math.round(semis)), `${e.value} Hz`).toBeLessThan(1e-6)
      }
    }
  })

  it('two stingers schedule different note sets', () => {
    const sets = STINGER_IDS.map((id) => {
      const { fake } = render(id)
      const freqs = fake.oscillators().flatMap((o) => o.frequency.events.map((e) => e.value.toFixed(2)))
      return [...new Set(freqs)].sort().join(',')
    })
    expect(new Set(sets).size).toBe(STINGER_IDS.length)
  })

  it('the noise is the same on every render (seeded, no Math.random)', () => {
    const noise = (fake: FakeAudioContext): number[] =>
      [
        ...fake.nodes.filter((n): n is FakeBufferSource => n instanceof FakeBufferSource).map((n) => n.buffer),
        ...fake.nodes.filter((n): n is FakeConvolver => n instanceof FakeConvolver).map((n) => n.buffer),
      ].flatMap((b) => Array.from(b!.getChannelData(0).subarray(0, 64)))
    for (const id of STINGER_IDS) {
      const a = noise(render(id).fake)
      expect(a.length).toBeGreaterThan(0)
      expect(noise(render(id).fake)).toEqual(a)
    }
  })

  it('the generated buffers carry no DC offset', () => {
    for (const id of STINGER_IDS) {
      const { fake } = render(id)
      const buffers = [
        ...fake.nodes.filter((n): n is FakeBufferSource => n instanceof FakeBufferSource).map((n) => n.buffer!),
        ...fake.nodes.filter((n): n is FakeConvolver => n instanceof FakeConvolver).map((n) => n.buffer!),
      ]
      for (const b of buffers) {
        for (let c = 0; c < b.numberOfChannels; c += 1) {
          const data = b.getChannelData(c)
          const mean = data.reduce((sum, x) => sum + x, 0) / data.length
          expect(Math.abs(mean)).toBeLessThan(1e-4)
        }
      }
    }
  })

  it('the master is gain 0.6 into a compressor into the destination', () => {
    const fake = new FakeAudioContext()
    const input = createMaster(fake.asContext()) as unknown as FakeGain
    expect(MASTER_GAIN).toBe(0.6)
    expect(input).toBeInstanceOf(FakeGain)
    expect(input.gain.value).toBe(0.6)
    expect(input.connections).toHaveLength(1)
    const limiter = input.connections[0] as FakeCompressor
    expect(limiter).toBeInstanceOf(FakeCompressor)
    expect(limiter.connections).toEqual([fake.destination])
    expect(limiter.threshold.value).toBe(-3)
    expect(limiter.ratio.value).toBe(20)
    expect(limiter.knee.value).toBe(0)
    expect((createMaster(fake.asContext(), 0.25) as unknown as FakeGain).gain.value).toBe(0.25)
  })
})
