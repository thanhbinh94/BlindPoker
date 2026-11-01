import { describe, expect, it, vi } from 'vitest'
import {
  MAX_SOUND_WAIT_S,
  SOUND_EVENT,
  SOUND_MUTED_KEY,
  attachGestureUnlock,
  createSoundEngine,
  type SoundEngine,
  type SoundEngineDeps,
  type SoundOutcome,
} from './engine.js'
import { FakeAudioContext, FakeCompressor, FakeGain, brokenStorage, memoryStorage } from './fake-audio.js'
import * as stingers from './stingers.js'
import type { StingerId } from './stingers.js'

/** Lets the engine's lazy `import()` of the stingers settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

interface Rig {
  engine: SoundEngine
  fake: FakeAudioContext
  storage: Storage
  createContext: ReturnType<typeof vi.fn>
  scheduled: { id: StingerId; when: number }[]
  emitted: [StingerId, SoundOutcome][]
  hidden: { value: boolean }
}

const rig = (over: Partial<SoundEngineDeps> & { state?: AudioContextState } = {}): Rig => {
  const fake = new FakeAudioContext({ state: over.state ?? 'running' })
  const storage = over.storage ?? memoryStorage()
  const scheduled: Rig['scheduled'] = []
  const emitted: Rig['emitted'] = []
  const hidden = { value: false }
  const createContext = vi.fn(() => fake.asContext())
  // The real master chain, a recording schedule: the composition has its own tests.
  const module: typeof stingers = {
    ...stingers,
    scheduleStinger: (_ctx, _out, id, when) => {
      scheduled.push({ id, when })
      return stingers.STINGER_SECONDS[id]
    },
  }
  const engine = createSoundEngine({
    createContext,
    storage,
    isHidden: () => hidden.value,
    emit: (id, outcome) => emitted.push([id, outcome]),
    loadStingers: () => Promise.resolve(module),
    ...over,
  })
  return { engine, fake, storage, createContext, scheduled, emitted, hidden }
}

const unlocked = async (over: Parameters<typeof rig>[0] = {}): Promise<Rig> => {
  const r = rig(over)
  r.engine.unlock()
  await flush()
  return r
}

/** The engine's channel: the one gain node feeding the master's input. */
const channelOf = (fake: FakeAudioContext): FakeGain[] => {
  const master = fake.nodes.find((n) => n instanceof FakeGain && n.connections.some((c) => c instanceof FakeCompressor))
  return master === undefined ? [] : (fake.feeding(master) as FakeGain[])
}

describe('the sound engine', () => {
  it('starts unmuted and reads a stored mute', () => {
    expect(rig().engine.muted).toBe(false)
    expect(rig({ storage: memoryStorage({ [SOUND_MUTED_KEY]: '1' }) }).engine.muted).toBe(true)
    expect(rig({ storage: null }).engine.muted).toBe(false)
  })

  it('a broken storage still works (unmuted, no throw)', () => {
    const { engine } = rig({ storage: brokenStorage() })
    expect(engine.muted).toBe(false)
    expect(() => engine.setMuted(true)).not.toThrow()
    expect(engine.muted).toBe(true)
    expect(() => engine.setMuted(false)).not.toThrow()
    expect(engine.muted).toBe(false)
  })

  it('setMuted persists and notifies', () => {
    const { engine, storage } = rig()
    const listener = vi.fn()
    const off = engine.subscribe(listener)
    engine.setMuted(true)
    expect(storage.getItem(SOUND_MUTED_KEY)).toBe('1')
    expect(listener).toHaveBeenCalledTimes(1)
    engine.setMuted(false)
    expect(storage.getItem(SOUND_MUTED_KEY)).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    engine.setMuted(true)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("muted → 'muted', schedules nothing", async () => {
    const r = await unlocked()
    r.engine.setMuted(true)
    expect(r.engine.play('entrance.god')).toBe('muted')
    expect(r.scheduled).toEqual([])
  })

  it("hidden → 'hidden'", async () => {
    const r = await unlocked()
    r.hidden.value = true
    expect(r.engine.play('entrance.god')).toBe('hidden')
    expect(r.scheduled).toEqual([])
  })

  it("no AudioContext → 'unsupported'", async () => {
    const r = rig({ createContext: () => null })
    r.engine.unlock()
    await flush()
    expect(r.engine.play('moment.jackpot')).toBe('unsupported')
    // and by default, in a page with no AudioContext at all (jsdom), before any gesture
    const bare = createSoundEngine({ storage: null, isHidden: () => false, emit: () => {} })
    expect(bare.play('moment.jackpot')).toBe('unsupported')
  })

  it("before unlock → 'blocked' and no context is created", () => {
    const r = rig()
    expect(r.engine.play('entrance.god')).toBe('blocked')
    expect(r.createContext).not.toHaveBeenCalled()
    expect(r.engine.running).toBe(false)
  })

  it("a context the browser keeps suspended, or stingers not yet loaded → 'blocked'", async () => {
    const r = rig({ state: 'suspended' })
    r.fake.resumeWorks = false
    r.engine.unlock()
    await flush()
    expect(r.fake.resumes).toBe(1)
    expect(r.engine.play('entrance.god')).toBe('blocked')

    let release: (m: typeof stingers) => void = () => {}
    const slow = rig({ loadStingers: () => new Promise((resolve) => (release = resolve)) })
    slow.engine.unlock()
    await flush()
    expect(slow.engine.play('entrance.god')).toBe('blocked')
    release(stingers)
    await flush()
    expect(slow.engine.play('entrance.god')).toBe('played')
  })

  it('loads the stingers once, on the first unlock, and tries again after a failed load', async () => {
    const load = vi.fn<() => Promise<typeof stingers>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(stingers)
    const r = rig({ loadStingers: load })
    expect(load).not.toHaveBeenCalled()
    r.engine.unlock()
    await flush()
    expect(r.engine.play('entrance.god')).toBe('blocked')
    r.engine.unlock()
    await flush()
    r.engine.unlock()
    await flush()
    expect(load).toHaveBeenCalledTimes(2)
    expect(r.engine.play('entrance.god')).toBe('played')
  })

  it("after unlock → 'played' at currentTime", async () => {
    const r = await unlocked()
    expect(r.createContext).toHaveBeenCalledTimes(1)
    expect(r.engine.running).toBe(true)
    r.fake.currentTime = 12.5
    expect(r.engine.play('entrance.demigod')).toBe('played')
    expect(r.scheduled).toEqual([{ id: 'entrance.demigod', when: 12.5 }])
  })

  it('unlock resumes a suspended context and creates it only once', async () => {
    const r = rig({ state: 'suspended' })
    r.engine.unlock()
    await flush()
    expect(r.fake.state).toBe('running')
    r.fake.state = 'suspended' // a phone suspends it when the screen locks
    r.engine.unlock()
    await flush()
    expect(r.fake.resumes).toBe(2)
    expect(r.createContext).toHaveBeenCalledTimes(1)
  })

  it('a second play waits for the first (scheduled at its end)', async () => {
    const r = await unlocked()
    r.fake.currentTime = 2
    r.engine.play('entrance.god')
    r.fake.currentTime = 3
    expect(r.engine.play('moment.jackpot')).toBe('played')
    expect(r.scheduled.map((s) => s.when)).toEqual([2, 2 + 3.5])
    // once the channel is free, the next starts at once
    r.fake.currentTime = 20
    r.engine.play('moment.demigod')
    expect(r.scheduled[2]!.when).toBe(20)
  })

  it("one more than MAX_SOUND_WAIT_S ahead → 'busy'", async () => {
    const r = await unlocked()
    expect(MAX_SOUND_WAIT_S).toBe(4)
    expect(r.engine.play('entrance.god')).toBe('played') // 0 → 3.5
    expect(r.engine.play('entrance.godslayer')).toBe('played') // waits 3.5 s: 3.5 → 7.5
    expect(r.engine.play('moment.jackpot')).toBe('busy') // would wait 7.5 s
    expect(r.scheduled).toHaveLength(2)
    r.fake.currentTime = 3.6 // 3.9 s ahead now
    expect(r.engine.play('moment.jackpot')).toBe('played')
    expect(r.scheduled[2]!.when).toBe(7.5)
  })

  it('a preempting play stops what is sounding and starts now', async () => {
    const r = await unlocked()
    r.engine.play('entrance.godslayer')
    const [first] = channelOf(r.fake)
    expect(first).toBeDefined()
    r.fake.currentTime = 1
    expect(r.engine.play('moment.ascend', { preempt: true })).toBe('played')
    expect(first!.disconnects).toBe(1)
    expect(r.scheduled[1]).toEqual({ id: 'moment.ascend', when: 1 })
    // a fresh channel feeds the master
    const now = channelOf(r.fake)
    expect(now).toHaveLength(1)
    expect(now[0]).not.toBe(first)
    // and the queue restarts from the preempting one
    expect(r.engine.play('moment.demigod')).toBe('played')
    expect(r.scheduled[2]!.when).toBe(1 + 2.5)
  })

  it('muting stops what is sounding', async () => {
    const r = await unlocked()
    r.engine.play('entrance.god')
    const [first] = channelOf(r.fake)
    r.engine.setMuted(true)
    expect(first!.disconnects).toBe(1)
    r.engine.setMuted(false)
    // the channel is free again: the next play starts now, not after the stopped one
    r.fake.currentTime = 0.5
    r.engine.play('moment.jackpot')
    expect(r.scheduled[1]!.when).toBe(0.5)
  })

  it('every outcome is emitted with its id', async () => {
    const r = rig()
    r.engine.play('entrance.god') // blocked
    r.engine.unlock()
    await flush()
    r.engine.play('entrance.demigod') // played
    r.engine.play('entrance.godslayer') // played (waits)
    r.engine.play('moment.ascend') // busy
    r.hidden.value = true
    r.engine.play('moment.demigod') // hidden
    r.engine.setMuted(true)
    r.engine.play('moment.godslain') // muted
    expect(r.emitted).toEqual([
      ['entrance.god', 'blocked'],
      ['entrance.demigod', 'played'],
      ['entrance.godslayer', 'played'],
      ['moment.ascend', 'busy'],
      ['moment.demigod', 'hidden'],
      ['moment.godslain', 'muted'],
    ])
    const none = rig({ createContext: () => null })
    none.engine.unlock()
    none.engine.play('moment.jackpot')
    expect(none.emitted).toEqual([['moment.jackpot', 'unsupported']])
  })

  it('by default the outcome is a window event', async () => {
    const fake = new FakeAudioContext()
    const engine = createSoundEngine({
      createContext: () => fake.asContext(),
      storage: null,
      isHidden: () => false,
      loadStingers: () => Promise.resolve(stingers),
    })
    const seen: unknown[] = []
    const listener = (e: Event): void => void seen.push((e as CustomEvent).detail)
    window.addEventListener(SOUND_EVENT, listener)
    engine.play('moment.jackpot')
    window.removeEventListener(SOUND_EVENT, listener)
    expect(SOUND_EVENT).toBe('bp:sound')
    expect(seen).toEqual([{ id: 'moment.jackpot', outcome: 'blocked' }])
  })

  it('unmuting never plays what was missed', async () => {
    const r = await unlocked()
    r.engine.setMuted(true)
    r.engine.play('entrance.god')
    r.hidden.value = true
    r.engine.setMuted(false)
    r.engine.play('moment.ascend')
    r.hidden.value = false
    await flush()
    expect(r.scheduled).toEqual([])
    expect(r.emitted.map(([, o]) => o)).toEqual(['muted', 'hidden'])
  })

  it('plays the real stingers through the master chain', async () => {
    const fake = new FakeAudioContext()
    const engine = createSoundEngine({
      createContext: () => fake.asContext(),
      storage: null,
      isHidden: () => false,
      emit: () => {},
      loadStingers: () => Promise.resolve(stingers),
    })
    engine.unlock()
    await flush()
    expect(engine.play('entrance.god')).toBe('played')
    expect(fake.oscillators().length).toBeGreaterThan(5)
    expect(fake.feeding(fake.destination)).toHaveLength(1)
  })
})

describe('attachGestureUnlock', () => {
  const fakeEngine = (): SoundEngine & { unlock: ReturnType<typeof vi.fn>; running: boolean } => {
    const e = {
      muted: false,
      running: false,
      setMuted: () => {},
      subscribe: () => () => {},
      play: () => 'blocked' as const,
      unlock: vi.fn(),
    }
    return e
  }

  it('calls unlock on each gesture until the context runs, again if it is suspended, and the remover detaches', () => {
    const target = new EventTarget()
    const engine = fakeEngine()
    const remove = attachGestureUnlock(engine, target)
    target.dispatchEvent(new Event('pointerdown'))
    target.dispatchEvent(new Event('keydown'))
    expect(engine.unlock).toHaveBeenCalledTimes(2)
    engine.running = true
    target.dispatchEvent(new Event('pointerdown'))
    target.dispatchEvent(new Event('pointerup'))
    expect(engine.unlock).toHaveBeenCalledTimes(2)
    engine.running = false // the phone suspended it
    target.dispatchEvent(new Event('pointerup'))
    expect(engine.unlock).toHaveBeenCalledTimes(3)
    remove()
    target.dispatchEvent(new Event('pointerdown'))
    target.dispatchEvent(new Event('keydown'))
    target.dispatchEvent(new Event('pointerup'))
    expect(engine.unlock).toHaveBeenCalledTimes(3)
  })

  it('listens on the window by default', () => {
    const engine = fakeEngine()
    const remove = attachGestureUnlock(engine)
    window.dispatchEvent(new Event('keydown'))
    remove()
    window.dispatchEvent(new Event('keydown'))
    expect(engine.unlock).toHaveBeenCalledTimes(1)
  })
})
