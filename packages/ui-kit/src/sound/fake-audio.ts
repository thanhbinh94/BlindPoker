/**
 * A recording stand-in for the Web Audio API, for the sound module's unit tests (jsdom has no `AudioContext`). It makes
 * no sound: it records every node made, every connection, every source's `start`/`stop` and every automation call, and
 * it throws where a browser would (an exponential ramp to or from zero, a time that is not a finite number ≥ 0), so a
 * mistake in a stinger fails a test instead of going silent in Chromium. Not exported from the package.
 */

export interface FakeEvent {
  kind: 'set' | 'linear' | 'exp' | 'target'
  value: number
  time: number
}

const checkTime = (time: number): void => {
  if (!Number.isFinite(time) || time < 0) throw new RangeError(`bad automation time ${time}`)
}

export class FakeParam {
  readonly events: FakeEvent[] = []
  private current: number
  constructor(
    readonly owner: FakeNode,
    readonly name: string,
    initial: number,
  ) {
    this.current = initial
  }

  get value(): number {
    return this.current
  }
  set value(v: number) {
    if (!Number.isFinite(v)) throw new TypeError(`bad value ${v}`)
    this.current = v
  }

  /** The value the last event leaves (or the plain value when none). */
  private last(): number {
    return this.events.length === 0 ? this.current : this.events[this.events.length - 1]!.value
  }

  setValueAtTime(value: number, time: number): this {
    checkTime(time)
    if (!Number.isFinite(value)) throw new TypeError(`bad value ${value}`)
    this.events.push({ kind: 'set', value, time })
    return this
  }
  linearRampToValueAtTime(value: number, time: number): this {
    checkTime(time)
    if (!Number.isFinite(value)) throw new TypeError(`bad value ${value}`)
    this.events.push({ kind: 'linear', value, time })
    return this
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    checkTime(time)
    // A browser throws on a target of 0 and holds a ramp that starts from 0 until its end, then jumps.
    if (!(value > 0) || !(this.last() > 0)) throw new RangeError(`exponential ramp ${this.last()} → ${value}`)
    this.events.push({ kind: 'exp', value, time })
    return this
  }
  setTargetAtTime(value: number, time: number, _constant: number): this {
    checkTime(time)
    this.events.push({ kind: 'target', value, time })
    return this
  }
  cancelScheduledValues(_time: number): this {
    return this
  }
}

type Destination = FakeNode | FakeParam

export class FakeNode {
  readonly connections: Destination[] = []
  disconnects = 0
  constructor(
    readonly context: FakeAudioContext,
    readonly kind: string,
  ) {
    context.nodes.push(this)
  }
  connect<T extends Destination>(destination: T): T {
    this.connections.push(destination)
    return destination
  }
  disconnect(): void {
    this.disconnects += 1
    this.connections.length = 0
  }
}

export class FakeSource extends FakeNode {
  startedAt: number | null = null
  stoppedAt: number | null = null
  start(when = 0): void {
    checkTime(when)
    if (this.startedAt !== null) throw new Error('started twice')
    this.startedAt = when
  }
  stop(when = 0): void {
    checkTime(when)
    this.stoppedAt = when
  }
}

export class FakeOscillator extends FakeSource {
  type: OscillatorType = 'sine'
  readonly frequency = new FakeParam(this, 'frequency', 440)
  readonly detune = new FakeParam(this, 'detune', 0)
  constructor(context: FakeAudioContext) {
    super(context, 'oscillator')
  }
}

export class FakeBuffer {
  private readonly channels: Float32Array[]
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
  }
  get duration(): number {
    return this.length / this.sampleRate
  }
  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel]
    if (data === undefined) throw new RangeError(`no channel ${channel}`)
    return data
  }
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null
  loop = false
  readonly playbackRate = new FakeParam(this, 'playbackRate', 1)
  constructor(context: FakeAudioContext) {
    super(context, 'bufferSource')
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(this, 'gain', 1)
  constructor(context: FakeAudioContext) {
    super(context, 'gain')
  }
}

export class FakeBiquad extends FakeNode {
  type: BiquadFilterType = 'lowpass'
  readonly frequency = new FakeParam(this, 'frequency', 350)
  readonly Q = new FakeParam(this, 'Q', 1)
  readonly gain = new FakeParam(this, 'gain', 0)
  readonly detune = new FakeParam(this, 'detune', 0)
  constructor(context: FakeAudioContext) {
    super(context, 'biquad')
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(this, 'threshold', -24)
  readonly knee = new FakeParam(this, 'knee', 30)
  readonly ratio = new FakeParam(this, 'ratio', 12)
  readonly attack = new FakeParam(this, 'attack', 0.003)
  readonly release = new FakeParam(this, 'release', 0.25)
  constructor(context: FakeAudioContext) {
    super(context, 'compressor')
  }
}

export class FakeShaper extends FakeNode {
  curve: Float32Array | null = null
  oversample: OverSampleType = 'none'
  constructor(context: FakeAudioContext) {
    super(context, 'waveShaper')
  }
}

export class FakeConvolver extends FakeNode {
  buffer: FakeBuffer | null = null
  normalize = true
  constructor(context: FakeAudioContext) {
    super(context, 'convolver')
  }
}

export class FakePanner extends FakeNode {
  readonly pan = new FakeParam(this, 'pan', 0)
  constructor(context: FakeAudioContext) {
    super(context, 'stereoPanner')
  }
}

export class FakeAudioContext {
  readonly nodes: FakeNode[] = []
  readonly destination: FakeNode
  currentTime = 0
  readonly sampleRate: number
  state: AudioContextState
  resumes = 0
  /** Whether `resume()` takes: a browser refuses outside a gesture. */
  resumeWorks = true

  constructor(opts: { state?: AudioContextState; sampleRate?: number } = {}) {
    this.state = opts.state ?? 'running'
    this.sampleRate = opts.sampleRate ?? 8_000
    this.destination = new FakeNode(this, 'destination')
  }

  resume(): Promise<void> {
    this.resumes += 1
    if (this.resumeWorks) this.state = 'running'
    return Promise.resolve()
  }

  createGain(): FakeGain {
    return new FakeGain(this)
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator(this)
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this)
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    if (!(channels > 0) || !(length > 0) || !Number.isInteger(length)) throw new RangeError(`buffer ${channels}×${length}`)
    return new FakeBuffer(channels, length, sampleRate)
  }
  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this)
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this)
  }
  createWaveShaper(): FakeShaper {
    return new FakeShaper(this)
  }
  createConvolver(): FakeConvolver {
    return new FakeConvolver(this)
  }
  createStereoPanner(): FakePanner {
    return new FakePanner(this)
  }

  /** This fake typed as the browser's, for the code under test. */
  asContext(): AudioContext {
    return this as unknown as AudioContext
  }

  sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource)
  }
  oscillators(): FakeOscillator[] {
    return this.nodes.filter((n): n is FakeOscillator => n instanceof FakeOscillator)
  }
  /** The nodes connected straight to `target`. */
  feeding(target: FakeNode): FakeNode[] {
    return this.nodes.filter((n) => n.connections.includes(target))
  }
}

/** An in-memory `Storage`, and one whose every call throws (a browser with storage blocked). */
export function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
  }
}

export function brokenStorage(): Storage {
  const fail = (): never => {
    throw new Error('storage blocked')
  }
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail }
}
