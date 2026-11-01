/**
 * The game's stingers, composed in code for the Web Audio API (BP-42, spec §5.2): no audio files, no dependency.
 *
 * This file has NO runtime imports (types only): the engine loads it lazily by `import()` on the first gesture, and the
 * Chromium measurement (`apps/normal-web/e2e/sound.spec.ts`) transpiles this one file alone and renders each stinger in
 * an `OfflineAudioContext`.
 *
 * House rules for every voice here:
 * - in tune: equal temperament from A4 = 440 Hz (`hz(midi)`); a held note sits on the grid, only sweeps leave it;
 * - on the 128 BPM grid, counted from each stinger's downbeat (`BEAT`, `S16`);
 * - no clicks: every gain starts at 0 and moves by ramps of a few ms at least; a pitch changes only while silent;
 * - deterministic: every noise and impulse comes from a seeded PRNG, so two renders are identical, and has its mean
 *   taken out (no DC offset); each stinger's bus also runs through a 24 Hz high-pass;
 * - silent for the last `END_PAD` (≥ 150 ms) of the stinger's length: every source has stopped by then, and the bus
 *   fade (after the reverb return) is at 0, so no tail rings past it.
 */

export type StingerId =
  | 'entrance.god'
  | 'entrance.demigod'
  | 'entrance.godslayer'
  | 'moment.ascend'
  | 'moment.demigod'
  | 'moment.godslain'
  | 'moment.jackpot'

export const STINGER_IDS: readonly StingerId[] = [
  'entrance.god',
  'entrance.demigod',
  'entrance.godslayer',
  'moment.ascend',
  'moment.demigod',
  'moment.godslain',
  'moment.jackpot',
]

export const STINGER_SECONDS: Readonly<Record<StingerId, number>> = {
  'entrance.god': 3.5,
  'entrance.demigod': 3.0,
  'entrance.godslayer': 4.0,
  'moment.ascend': 2.5,
  'moment.demigod': 2.0,
  'moment.godslain': 2.5,
  'moment.jackpot': 2.0,
}

export const MASTER_GAIN = 0.6

/**
 * gain(volume) → limiter (DynamicsCompressor) → ctx.destination; returns the chain's input. The limiter is set hard
 * (ratio 20, no knee) just under full scale: Web Audio's compressor adds its own make-up gain (about +1.7 dB here), so
 * a threshold of −3 dB keeps the peaks under 1.0.
 */
export function createMaster(ctx: BaseAudioContext, volume: number = MASTER_GAIN): AudioNode {
  const gain = ctx.createGain()
  gain.gain.value = volume
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -3
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.25
  gain.connect(limiter)
  limiter.connect(ctx.destination)
  return gain
}

/** Schedules the stinger into `out` from `when` (ctx seconds); returns its length in seconds (= STINGER_SECONDS[id]). */
export function scheduleStinger(ctx: BaseAudioContext, out: AudioNode, id: StingerId, when: number): number {
  const len = STINGER_SECONDS[id]
  const spec = COMPOSITIONS[id]
  const r = rig(ctx, out, when, len, spec.reverb)
  spec.compose(r)
  return len
}

// ---------------------------------------------------------------------------------------------------------------
// Time, pitch, noise

/** One beat at 128 BPM, and a sixteenth. */
const BEAT = 60 / 128
const S16 = BEAT / 4
/** The stinger's last stretch that is silent (the brief asks 150 ms; a little more for the limiter's 6 ms look-ahead). */
const END_PAD = 0.16
/** How long the bus takes to fade the reverb return out before the silent stretch. */
const BUS_FADE = 0.12

/** Equal temperament from A4 = 440 Hz. */
const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)

/** mulberry32: a small seeded PRNG, so every noise is the same on every render. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Takes the mean out, so a buffer carries no DC offset. */
function centre(data: Float32Array): void {
  let sum = 0
  for (let i = 0; i < data.length; i += 1) sum += data[i]!
  const mean = sum / data.length
  for (let i = 0; i < data.length; i += 1) data[i] = data[i]! - mean
}

/** White noise, `seconds` long, mono. */
function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const length = Math.max(1, Math.ceil(seconds * ctx.sampleRate))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  const rand = prng(seed)
  for (let i = 0; i < length; i += 1) data[i] = rand() * 2 - 1
  centre(data)
  return buffer
}

/** A stereo reverb impulse: noise under a power-law decay, each side its own seed (width). */
function impulse(ctx: BaseAudioContext, seconds: number, decay: number, seed: number): AudioBuffer {
  const length = Math.max(1, Math.ceil(seconds * ctx.sampleRate))
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let c = 0; c < 2; c += 1) {
    const data = buffer.getChannelData(c)
    const rand = prng(seed + c * 7919)
    for (let i = 0; i < length; i += 1) data[i] = (rand() * 2 - 1) * (1 - i / length) ** decay
    centre(data)
  }
  return buffer
}

// ---------------------------------------------------------------------------------------------------------------
// Envelopes (every one starts from 0 and moves by ramps)

/** A hit: up in `attack`, an exponential fall to −60 dB over `decay`, then to 0. Returns when it is silent. */
function perc(param: AudioParam, at: number, peak: number, attack: number, decay: number): number {
  param.setValueAtTime(0, at)
  param.linearRampToValueAtTime(peak, at + attack)
  param.exponentialRampToValueAtTime(peak * 0.001, at + attack + decay)
  param.linearRampToValueAtTime(0, at + attack + decay + 0.01)
  return at + attack + decay + 0.01
}

/** A held sound: up in `attack`, held until `hold`, a straight fall to 0 at `end`. */
function swell(param: AudioParam, at: number, peak: number, attack: number, hold: number, end: number): void {
  param.setValueAtTime(0, at)
  param.linearRampToValueAtTime(peak, at + attack)
  param.setValueAtTime(peak, Math.max(hold, at + attack))
  param.linearRampToValueAtTime(0, end)
}

/** A build: an exponential climb to `peak` over `dur`, cut in 30 ms at the drop. Returns when it is silent. */
function rise(param: AudioParam, at: number, peak: number, dur: number): number {
  param.setValueAtTime(0, at)
  param.linearRampToValueAtTime(peak * 0.08, at + 0.03)
  param.exponentialRampToValueAtTime(peak, at + dur)
  param.linearRampToValueAtTime(0, at + dur + 0.03)
  return at + dur + 0.03
}

// ---------------------------------------------------------------------------------------------------------------
// The rig: one stinger's bus, its reverb and its clock

interface Reverb {
  seconds: number
  /** The impulse's power-law decay (higher = shorter-sounding). */
  decay: number
  wet: number
  seed: number
}

interface Rig {
  ctx: BaseAudioContext
  /** The dry bus input (→ DC high-pass → fade → out). */
  dry: AudioNode
  /** The reverb send. */
  verb: AudioNode
  /** The stinger's start, and the time from which it is silent. */
  t0: number
  end: number
}

function rig(ctx: BaseAudioContext, out: AudioNode, t0: number, len: number, reverb: Reverb): Rig {
  const end = t0 + len - END_PAD
  const fade = ctx.createGain()
  fade.gain.setValueAtTime(1, t0)
  fade.gain.setValueAtTime(1, end - BUS_FADE)
  fade.gain.linearRampToValueAtTime(0, end)
  fade.connect(out)
  const dc = ctx.createBiquadFilter()
  dc.type = 'highpass'
  dc.frequency.setValueAtTime(24, t0)
  dc.Q.setValueAtTime(0.707, t0)
  dc.connect(fade)
  const convolver = ctx.createConvolver()
  convolver.buffer = impulse(ctx, reverb.seconds, reverb.decay, reverb.seed)
  const wet = ctx.createGain()
  wet.gain.setValueAtTime(reverb.wet, t0)
  convolver.connect(wet)
  wet.connect(dc)
  return { ctx, dry: dc, verb: convolver, t0, end }
}

/** Sends `node` to the dry bus and, `send` > 0, to the reverb. */
function route(r: Rig, node: AudioNode, send: number): void {
  node.connect(r.dry)
  if (send > 0) {
    const s = r.ctx.createGain()
    s.gain.setValueAtTime(send, r.t0)
    node.connect(s)
    s.connect(r.verb)
  }
}

function filter(r: Rig, type: BiquadFilterType, at: number, frequency: number, q = 0.707): BiquadFilterNode {
  const f = r.ctx.createBiquadFilter()
  f.type = type
  f.frequency.setValueAtTime(frequency, at)
  f.Q.setValueAtTime(q, at)
  return f
}

function osc(r: Rig, type: OscillatorType, at: number, frequency: number, detune = 0): OscillatorNode {
  const o = r.ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(frequency, at)
  if (detune !== 0) o.detune.setValueAtTime(detune, at)
  return o
}

function noise(r: Rig, at: number, seconds: number, seed: number): AudioBufferSourceNode {
  const src = r.ctx.createBufferSource()
  src.buffer = noiseBuffer(r.ctx, seconds + 0.05, seed)
  return src
}

function play(src: AudioScheduledSourceNode, at: number, stop: number): void {
  src.start(at)
  src.stop(stop)
}

// ---------------------------------------------------------------------------------------------------------------
// Voices

/** A four-on-the-floor kick: a sine diving `from` → `to` Hz in `drop` s, the body decaying over `decay`. */
function kick(r: Rig, at: number, o: { gain: number; from?: number; to?: number; drop?: number; decay: number; send?: number }): void {
  const sine = osc(r, 'sine', at, o.from ?? 150)
  sine.frequency.exponentialRampToValueAtTime(o.to ?? 45, at + (o.drop ?? 0.12))
  const g = r.ctx.createGain()
  const stop = perc(g.gain, at, o.gain, 0.003, o.decay)
  sine.connect(g)
  route(r, g, o.send ?? 0)
  play(sine, at, stop + 0.005)
}

/** A white-noise riser: a band-pass sweeping `from` → `to` Hz while the level climbs, cut at the drop. */
function riser(r: Rig, at: number, dur: number, o: { seed: number; from: number; to: number; q: number; gain: number; send?: number }): void {
  const src = noise(r, at, dur + 0.05, o.seed)
  const bp = filter(r, 'bandpass', at, o.from, o.q)
  bp.frequency.exponentialRampToValueAtTime(o.to, at + dur)
  const g = r.ctx.createGain()
  const stop = rise(g.gain, at, o.gain, dur)
  src.connect(bp)
  bp.connect(g)
  route(r, g, o.send ?? 0)
  play(src, at, stop + 0.005)
}

/** A rising tone (a saw or a square gliding up through a low-pass that opens), cut at the drop. */
function sweep(
  r: Rig,
  at: number,
  dur: number,
  o: { type: OscillatorType; from: number; to: number; cutoffFrom: number; cutoffTo: number; gain: number; send?: number },
): void {
  const tone = osc(r, o.type, at, o.from)
  tone.frequency.exponentialRampToValueAtTime(o.to, at + dur)
  const lp = filter(r, 'lowpass', at, o.cutoffFrom, 1.2)
  lp.frequency.exponentialRampToValueAtTime(o.cutoffTo, at + dur)
  const g = r.ctx.createGain()
  const stop = rise(g.gain, at, o.gain, dur)
  tone.connect(lp)
  lp.connect(g)
  route(r, g, o.send ?? 0)
  play(tone, at, stop + 0.005)
}

interface ChordOptions {
  type?: OscillatorType
  /** Cents of each copy of every note: three or more copies make a supersaw. */
  detune?: readonly number[]
  /** How far the detuned copies are spread left and right (0 = mono). */
  spread?: number
  attack: number
  hold: number
  end: number
  /** The chord's overall level (shared out over its oscillators). */
  level: number
  cutoff: number
  /** A filter that opens from here to `cutoff` over `filterTime` (the brass swell). */
  cutoffFrom?: number
  filterTime?: number
  q?: number
  send?: number
}

/** A chord (or one note): every note in several detuned copies, one low-pass, one envelope. Supersaw, pad or sub. */
function chord(r: Rig, at: number, notes: readonly number[], o: ChordOptions): void {
  const detune = o.detune ?? [0]
  const lp = filter(r, 'lowpass', at, o.cutoffFrom ?? o.cutoff, o.q ?? 0.9)
  if (o.cutoffFrom !== undefined) lp.frequency.exponentialRampToValueAtTime(o.cutoff, at + (o.filterTime ?? o.attack))
  const g = r.ctx.createGain()
  swell(g.gain, at, o.level / Math.sqrt(notes.length * detune.length), o.attack, o.hold, o.end)
  lp.connect(g)
  route(r, g, o.send ?? 0)
  const widest = Math.max(...detune.map(Math.abs), 1)
  let k = 0
  for (const note of notes) {
    for (const cents of detune) {
      // copies a hair apart in time, so their phases do not all line up into one spike at the start
      const start = at + (k % 5) * 0.0011
      const tone = osc(r, o.type ?? 'sawtooth', start, hz(note), cents)
      if (o.spread !== undefined && o.spread > 0 && cents !== 0) {
        const pan = r.ctx.createStereoPanner()
        pan.pan.setValueAtTime((o.spread * cents) / widest, at)
        tone.connect(pan)
        pan.connect(lp)
      } else {
        tone.connect(lp)
      }
      play(tone, start, o.end + 0.005)
      k += 1
    }
  }
}

/** An EDM pluck: two saws a few cents apart through a low-pass that snaps shut, a quick decay. */
function pluck(r: Rig, at: number, note: number, o: { gain: number; decay: number; cutoff: number; pan?: number; send?: number }): void {
  const f = hz(note)
  const lp = filter(r, 'lowpass', at, o.cutoff, 2)
  lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.5, 300), at + o.decay * 0.6)
  const g = r.ctx.createGain()
  const stop = perc(g.gain, at, o.gain, 0.004, o.decay)
  let last: AudioNode = g
  if (o.pan !== undefined) {
    const pan = r.ctx.createStereoPanner()
    pan.pan.setValueAtTime(o.pan, at)
    g.connect(pan)
    last = pan
  }
  lp.connect(g)
  route(r, last, o.send ?? 0)
  for (const cents of [-7, 7]) {
    const tone = osc(r, 'sawtooth', at, f, cents)
    tone.connect(lp)
    play(tone, at, stop + 0.005)
  }
}

/** A bell or a ding: a tone and its octave (a sine sparkle, or a slot machine's square ding through a low-pass). */
function bell(r: Rig, at: number, note: number, o: { type?: OscillatorType; gain: number; decay: number; pan?: number; send?: number }): void {
  const type = o.type ?? 'sine'
  const g = r.ctx.createGain()
  const stop = perc(g.gain, at, o.gain, 0.002, o.decay)
  let last: AudioNode = g
  if (o.pan !== undefined) {
    const pan = r.ctx.createStereoPanner()
    pan.pan.setValueAtTime(o.pan, at)
    g.connect(pan)
    last = pan
  }
  route(r, last, o.send ?? 0)
  const lp = filter(r, 'lowpass', at, type === 'sine' ? 12_000 : 6_500)
  lp.connect(g)
  const body = osc(r, type, at, hz(note))
  const octave = osc(r, 'sine', at, hz(note + 12))
  const octaveLevel = r.ctx.createGain()
  octaveLevel.gain.setValueAtTime(0.35, at)
  body.connect(lp)
  octave.connect(octaveLevel)
  octaveLevel.connect(lp)
  play(body, at, stop + 0.005)
  play(octave, at, stop + 0.005)
}

/** A reese bass: two saws beating against each other, under a low-pass an LFO sweeps (its rate may speed up). */
function reese(
  r: Rig,
  at: number,
  note: number,
  o: { attack: number; hold: number; end: number; gain: number; cutoff: number; lfoRate: number; lfoTo?: number; lfoDepth: number; send?: number },
): void {
  const lp = filter(r, 'lowpass', at, o.cutoff, 4)
  const lfo = osc(r, 'sine', at, o.lfoRate)
  if (o.lfoTo !== undefined) lfo.frequency.exponentialRampToValueAtTime(o.lfoTo, o.hold)
  const depth = r.ctx.createGain()
  depth.gain.setValueAtTime(Math.min(o.lfoDepth, o.cutoff * 0.8), at)
  lfo.connect(depth)
  depth.connect(lp.frequency)
  const g = r.ctx.createGain()
  swell(g.gain, at, o.gain, o.attack, o.hold, o.end)
  lp.connect(g)
  route(r, g, o.send ?? 0)
  play(lfo, at, o.end + 0.005)
  for (const cents of [-16, 16]) {
    const tone = osc(r, 'sawtooth', at, hz(note), cents)
    tone.connect(lp)
    play(tone, at, o.end + 0.005)
  }
}

/** tanh, scaled so ±1 stays ±1: odd, so it adds harmonics and no DC. */
function driveCurve(drive: number) {
  const n = 2049
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(drive * x) / Math.tanh(drive)
  }
  return curve
}

/** One riff note: [the sixteenth it starts on, its MIDI note, how many sixteenths it lasts]. */
type RiffNote = readonly [step: number, note: number, steps: number]

/**
 * A growling bass riff: a saw and a sine an octave under it, wave-shaped (tanh) and wobbled by a low-pass on an
 * eighth-note LFO. Each note is gated by its own envelope; the pitch only changes while the gate is shut.
 */
function growl(r: Rig, at: number, riff: readonly RiffNote[], o: { gain: number; drive: number; cutoff: number; lfoDepth: number; send?: number }): void {
  const first = riff[0]
  const lastNote = riff[riff.length - 1]
  if (first === undefined || lastNote === undefined) return
  const end = at + (lastNote[0] + lastNote[2]) * S16
  const saw = osc(r, 'sawtooth', at, hz(first[1]))
  const sub = osc(r, 'sine', at, hz(first[1] - 12))
  const pre = r.ctx.createGain()
  pre.gain.setValueAtTime(0.6, at)
  const shaper = r.ctx.createWaveShaper()
  shaper.curve = driveCurve(o.drive)
  const lp = filter(r, 'lowpass', at, o.cutoff, 5)
  const lfo = osc(r, 'sine', at, 2 / BEAT) // eighth notes
  const depth = r.ctx.createGain()
  depth.gain.setValueAtTime(Math.min(o.lfoDepth, o.cutoff * 0.8), at)
  lfo.connect(depth)
  depth.connect(lp.frequency)
  const gate = r.ctx.createGain()
  gate.gain.setValueAtTime(0, at)
  for (const [step, note, steps] of riff) {
    const on = at + step * S16
    const off = at + (step + steps) * S16 - 0.012
    saw.frequency.setValueAtTime(hz(note), on)
    sub.frequency.setValueAtTime(hz(note - 12), on)
    gate.gain.setValueAtTime(0, on)
    gate.gain.linearRampToValueAtTime(o.gain, on + 0.006)
    gate.gain.setValueAtTime(o.gain, off - 0.02)
    gate.gain.linearRampToValueAtTime(0, off)
  }
  saw.connect(pre)
  sub.connect(pre)
  pre.connect(shaper)
  shaper.connect(lp)
  lp.connect(gate)
  route(r, gate, o.send ?? 0)
  for (const src of [saw, sub, lfo]) play(src, at, end + 0.005)
}

/** A sword's slash: noise through a resonant high-pass sweeping `from` → `to` Hz, sharp in, quick out. */
function slash(r: Rig, at: number, o: { seed: number; dur: number; from: number; to: number; gain: number; send?: number }): void {
  const src = noise(r, at, o.dur, o.seed)
  const hp = filter(r, 'highpass', at, o.from, 6)
  hp.frequency.exponentialRampToValueAtTime(o.to, at + o.dur)
  const g = r.ctx.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(o.gain, at + 0.006)
  g.gain.exponentialRampToValueAtTime(o.gain * 0.4, at + o.dur * 0.7)
  g.gain.linearRampToValueAtTime(0, at + o.dur)
  src.connect(hp)
  hp.connect(g)
  route(r, g, o.send ?? 0)
  play(src, at, at + o.dur + 0.005)
}

/** The blade's ring after the slash: a cluster of high sines (a tritone and a major seventh), fading out. */
function ring(r: Rig, at: number, notes: readonly number[], o: { gain: number; decay: number; send?: number }): void {
  notes.forEach((note, i) => bell(r, at, note, { gain: o.gain / (i + 1), decay: o.decay * (1 - i * 0.2), pan: [0, -0.4, 0.4][i % 3], send: o.send }))
}

/** A crash cymbal: high-passed noise with a long decay. */
function crash(r: Rig, at: number, o: { seed: number; decay: number; gain: number; send?: number }): void {
  const src = noise(r, at, o.decay + 0.02, o.seed)
  const hp = filter(r, 'highpass', at, 5_000, 0.8)
  const peak = filter(r, 'peaking', at, 9_000, 1.2)
  peak.gain.setValueAtTime(5, at)
  const g = r.ctx.createGain()
  const stop = perc(g.gain, at, o.gain, 0.002, o.decay)
  src.connect(hp)
  hp.connect(peak)
  peak.connect(g)
  route(r, g, o.send ?? 0)
  play(src, at, stop + 0.005)
}

/** A snare: a band of noise and a short G3 body. */
function snare(r: Rig, at: number, o: { seed: number; gain: number; send?: number }): void {
  const src = noise(r, at, 0.14, o.seed)
  const bp = filter(r, 'bandpass', at, 1_900, 0.8)
  const g = r.ctx.createGain()
  const stop = perc(g.gain, at, o.gain, 0.002, 0.11)
  src.connect(bp)
  bp.connect(g)
  route(r, g, o.send ?? 0)
  play(src, at, stop + 0.005)
  const body = osc(r, 'triangle', at, hz(55))
  const bg = r.ctx.createGain()
  const bodyStop = perc(bg.gain, at, o.gain * 0.6, 0.002, 0.06)
  body.connect(bg)
  route(r, bg, 0)
  play(body, at, bodyStop + 0.005)
}

// ---------------------------------------------------------------------------------------------------------------
// The seven stingers

interface Composition {
  reverb: Reverb
  compose: (r: Rig) => void
}

// MIDI notes used below, by name.
const D2 = 38, D3 = 50, F3s = 54, A3 = 57, D4 = 62, F4s = 66, A4 = 69, D5 = 74, F5s = 78
const C4s = 61, E4 = 64, C5s = 73, E5 = 76, A5 = 81, C6s = 85, E6 = 88, A6 = 93, B6 = 95, C7s = 97, E7 = 100, F7s = 102, A7 = 105
const E2 = 40, F2s = 42, G2 = 43, B1 = 35, E3 = 52, G3 = 55, B3 = 59
const G4s = 68, B4 = 71, G6s = 92, G7s = 104, B7 = 107, E8 = 112, A7s = 106, D8s = 111, G7 = 103, C8s = 109

const COMPOSITIONS: Readonly<Record<StingerId, Composition>> = {
  /**
   * Thần Bài — D major, majestic. A 1.2 s noise riser with a saw gliding D3 → D5; the drop at 1.25 s: a heavy kick, a
   * crash, a brass supersaw (D3 F#3 A3 D4, filter swelling open) and a sub on D2; a fanfare line A4 → D5 on top; a
   * second kick on beat 3; the chord rings out in a long hall.
   */
  'entrance.god': {
    reverb: { seconds: 1.8, decay: 2.6, wet: 0.3, seed: 1101 },
    compose: (r) => {
      const drop = r.t0 + 1.25
      riser(r, drop - 1.2, 1.2, { seed: 1102, from: 350, to: 7_000, q: 1.8, gain: 0.3, send: 0.2 })
      sweep(r, drop - 1.2, 1.2, { type: 'sawtooth', from: hz(D3), to: hz(D5), cutoffFrom: 900, cutoffTo: 5_000, gain: 0.07, send: 0.2 })
      kick(r, drop, { gain: 0.8, decay: 0.55, send: 0.08 })
      kick(r, drop + 2 * BEAT, { gain: 0.65, decay: 0.45, send: 0.08 })
      crash(r, drop, { seed: 1103, decay: 1.6, gain: 0.15, send: 0.3 })
      chord(r, drop, [D3, F3s, A3, D4], {
        detune: [-11, 0, 11],
        spread: 0.6,
        attack: 0.09,
        hold: r.end - 0.8,
        end: r.end,
        level: 0.34,
        cutoff: 3_000,
        cutoffFrom: 700,
        filterTime: 0.25,
        send: 0.35,
      })
      chord(r, drop, [A4], { detune: [-8, 8], spread: 0.3, attack: 0.03, hold: drop + 1.5 * BEAT - 0.05, end: drop + 1.5 * BEAT + 0.03, level: 0.13, cutoff: 3_500, send: 0.3 })
      chord(r, drop + 1.5 * BEAT, [D5], { detune: [-8, 8], spread: 0.3, attack: 0.03, hold: r.end - 0.7, end: r.end, level: 0.14, cutoff: 3_500, send: 0.35 })
      chord(r, drop + 0.1, [D2], { type: 'sine', attack: 0.2, hold: r.end - 0.8, end: r.end, level: 0.26, cutoff: 400 })
    },
  },

  /**
   * Bán Thần — A major, bright. A soft triangle pad swells from the start with an airy noise shimmer; a pluck arpeggio
   * climbs in sixteenths (A4 C#5 E5 A5 C#6 E6) straight into a light kick at 0.9 s, which lands with a pluck stab;
   * high sine sparkles on the A-major pentatonic twinkle over the pad as it rings out.
   */
  'entrance.demigod': {
    reverb: { seconds: 2.0, decay: 2.2, wet: 0.38, seed: 1201 },
    compose: (r) => {
      const hit = r.t0 + 0.9
      chord(r, r.t0, [A3, C4s, E4, A4], {
        type: 'triangle',
        detune: [-6, 6],
        spread: 0.4,
        attack: 0.7,
        hold: r.end - 0.65,
        end: r.end,
        level: 0.24,
        cutoff: 3_500,
        cutoffFrom: 1_200,
        filterTime: 1.2,
        send: 0.4,
      })
      riser(r, r.t0, 0.9, { seed: 1202, from: 1_500, to: 9_000, q: 0.9, gain: 0.07, send: 0.3 })
      ;[A4, C5s, E5, A5, C6s, E6].forEach((note, i) =>
        pluck(r, hit - (6 - i) * S16, note, { gain: 0.13 + i * 0.012, decay: 0.32, cutoff: 5_000, pan: i % 2 === 0 ? -0.3 : 0.3, send: 0.35 }),
      )
      kick(r, hit, { gain: 0.6, from: 130, to: 52, drop: 0.08, decay: 0.32, send: 0.05 })
      for (const note of [A5, C6s, E6]) pluck(r, hit, note, { gain: 0.1, decay: 0.6, cutoff: 6_000, send: 0.4 })
      const sparkles: readonly [number, number][] = [[1, E7], [3, C7s], [4, A6], [6, F7s], [8, E7], [10, B6], [11, C7s], [13, A7]]
      sparkles.forEach(([step, note], i) =>
        bell(r, hit + step * S16, note, { gain: 0.045, decay: 0.33, pan: i % 2 === 0 ? 0.45 : -0.45, send: 0.5 }),
      )
    },
  },

  /**
   * Kẻ Sát Thần — E minor, fierce. A reese bass on E2 growls under a 1.5 s riser and two saws a semitone apart (E4/F4)
   * sliding up an octave, its LFO speeding up; a snare roll tightens into the drop at 1.6 s: a heavy kick, a crash and
   * a wave-shaped bass riff (E E E G F# E in sixteenths) wobbling on eighths; at 3.24 s the slash (high-pass 8 kHz →
   * 500 Hz in 0.25 s), the blade's ring and a low boom, over a dark E hum that fades.
   */
  'entrance.godslayer': {
    reverb: { seconds: 1.6, decay: 2.8, wet: 0.32, seed: 1301 },
    compose: (r) => {
      const drop = r.t0 + 1.6
      const cut = drop + 14 * S16
      reese(r, r.t0, E2, { attack: 0.35, hold: drop - 0.03, end: drop, gain: 0.22, cutoff: 520, lfoRate: 1 / BEAT, lfoTo: 4 / BEAT, lfoDepth: 320 })
      riser(r, drop - 1.5, 1.5, { seed: 1302, from: 250, to: 6_000, q: 2.5, gain: 0.28, send: 0.15 })
      for (const note of [E4, E4 + 1]) {
        sweep(r, drop - 1.5, 1.5, { type: 'sawtooth', from: hz(note), to: hz(note + 12), cutoffFrom: 700, cutoffTo: 2_400, gain: 0.04 })
      }
      const roll = [8, 7, 6, 5, 4, 3, 2, 1.5, 1, 0.5]
      roll.forEach((ahead, i) => snare(r, drop - ahead * S16, { seed: 1310 + i, gain: 0.06 + (i * 0.14) / (roll.length - 1), send: 0.15 }))
      kick(r, drop, { gain: 0.85, from: 160, to: 40, decay: 0.7, send: 0.1 })
      kick(r, drop + 8 * S16, { gain: 0.72, from: 160, to: 40, decay: 0.5, send: 0.1 })
      crash(r, drop, { seed: 1303, decay: 1.2, gain: 0.13, send: 0.25 })
      growl(r, drop, [[0, E2, 3], [3, E2, 3], [6, E2, 2], [8, G2, 2], [10, F2s, 2], [12, E2, 2]], { gain: 0.3, drive: 5, cutoff: 950, lfoDepth: 650, send: 0.1 })
      slash(r, cut, { seed: 1304, dur: 0.25, from: 8_000, to: 500, gain: 0.34, send: 0.45 })
      ring(r, cut + 0.02, [E7, A7s, D8s], { gain: 0.05, decay: 0.5, send: 0.5 })
      kick(r, cut, { gain: 0.55, from: 120, to: 38, drop: 0.1, decay: 0.5, send: 0.15 })
      reese(r, cut, E2, { attack: 0.06, hold: cut + 0.12, end: r.end, gain: 0.13, cutoff: 260, lfoRate: 1, lfoDepth: 90 })
    },
  },

  /**
   * The Thần's ascension (BP-41's god moment) — D major, the god entrance's short cousin. A 0.4 s riser with a saw
   * gliding A3 → A4 (the dominant, resolving); the drop at 0.45 s: kick, crash, a brass supersaw in second inversion
   * (A3 D4 F#4 A4), a sub; the lead climbs A4 → D5 → F#5 one beat at a time.
   */
  'moment.ascend': {
    reverb: { seconds: 1.6, decay: 2.6, wet: 0.3, seed: 1401 },
    compose: (r) => {
      const drop = r.t0 + 0.45
      riser(r, drop - 0.4, 0.4, { seed: 1402, from: 600, to: 8_000, q: 1.6, gain: 0.28, send: 0.2 })
      sweep(r, drop - 0.4, 0.4, { type: 'sawtooth', from: hz(A3), to: hz(A4), cutoffFrom: 1_000, cutoffTo: 5_000, gain: 0.06, send: 0.2 })
      kick(r, drop, { gain: 0.8, decay: 0.5, send: 0.08 })
      kick(r, drop + 2 * BEAT, { gain: 0.62, decay: 0.4, send: 0.08 })
      crash(r, drop, { seed: 1403, decay: 1.3, gain: 0.14, send: 0.3 })
      chord(r, drop, [A3, D4, F4s, A4], {
        detune: [-11, 0, 11],
        spread: 0.6,
        attack: 0.06,
        hold: r.end - 0.6,
        end: r.end,
        level: 0.3,
        cutoff: 3_400,
        cutoffFrom: 900,
        filterTime: 0.2,
        send: 0.35,
      })
      const lead = { detune: [-8, 8], spread: 0.3, attack: 0.02, level: 0.12, cutoff: 3_800, send: 0.35 } as const
      chord(r, drop, [A4], { ...lead, hold: drop + BEAT - 0.02, end: drop + BEAT + 0.03 })
      chord(r, drop + BEAT, [D5], { ...lead, hold: drop + 2 * BEAT - 0.02, end: drop + 2 * BEAT + 0.03 })
      chord(r, drop + 2 * BEAT, [F5s], { ...lead, hold: r.end - 0.6, end: r.end })
      chord(r, drop + 0.08, [D2], { type: 'sine', attack: 0.15, hold: r.end - 0.6, end: r.end, level: 0.24, cutoff: 400 })
    },
  },

  /**
   * The Demigod moment — A major, the demigod entrance's short cousin. Four plucks (A5 C#6 E6 A6) in sixteenths into a
   * light kick at 0.49 s with a pluck stab (E5 A5 C#6); a bright pad (C#4 E4 A4 C#5) and five sparkles over it.
   */
  'moment.demigod': {
    reverb: { seconds: 1.6, decay: 2.2, wet: 0.38, seed: 1501 },
    compose: (r) => {
      const hit = r.t0 + 0.02 + 4 * S16
      chord(r, r.t0, [C4s, E4, A4, C5s], {
        type: 'triangle',
        detune: [-6, 6],
        spread: 0.4,
        attack: 0.35,
        hold: r.end - 0.38,
        end: r.end,
        level: 0.22,
        cutoff: 3_800,
        cutoffFrom: 1_500,
        filterTime: 0.6,
        send: 0.4,
      })
      ;[A5, C6s, E6, A6].forEach((note, i) =>
        pluck(r, hit - (4 - i) * S16, note, { gain: 0.13 + i * 0.01, decay: 0.3, cutoff: 6_000, pan: i % 2 === 0 ? -0.3 : 0.3, send: 0.35 }),
      )
      kick(r, hit, { gain: 0.55, from: 130, to: 52, drop: 0.08, decay: 0.3, send: 0.05 })
      for (const note of [E5, A5, C6s]) pluck(r, hit, note, { gain: 0.09, decay: 0.5, cutoff: 6_000, send: 0.4 })
      const sparkles: readonly [number, number][] = [[1, E7], [3, C7s], [5, A7], [6, F7s], [8, E7]]
      sparkles.forEach(([step, note], i) => bell(r, hit + step * S16, note, { gain: 0.045, decay: 0.3, pan: i % 2 === 0 ? 0.45 : -0.45, send: 0.5 }))
    },
  },

  /**
   * The Thần slain — E minor, the godslayer's short cousin. It opens on the slash and a higher blade ring (G7 C#8),
   * then the low hit two sixteenths later: a deep kick, a crash, a wave-shaped bass (E2, B1, E2) and a dark saw chord
   * (E3 G3 B3) that rings out.
   */
  'moment.godslain': {
    reverb: { seconds: 1.5, decay: 2.8, wet: 0.32, seed: 1601 },
    compose: (r) => {
      const cut = r.t0 + 0.02
      const low = cut + 2 * S16
      slash(r, cut, { seed: 1602, dur: 0.25, from: 8_000, to: 500, gain: 0.34, send: 0.4 })
      ring(r, cut + 0.02, [G7, C8s], { gain: 0.045, decay: 0.5, send: 0.5 })
      kick(r, low, { gain: 0.85, from: 140, to: 36, drop: 0.12, decay: 0.65, send: 0.1 })
      crash(r, low, { seed: 1603, decay: 1.0, gain: 0.12, send: 0.25 })
      growl(r, low, [[0, E2, 4], [4, B1, 2], [6, E2, 6]], { gain: 0.28, drive: 5, cutoff: 900, lfoDepth: 600, send: 0.1 })
      chord(r, low, [E3, G3, B3], { detune: [-12, 0, 12], spread: 0.5, attack: 0.02, hold: r.end - 0.7, end: r.end, level: 0.2, cutoff: 1_400, send: 0.35 })
    },
  },

  /**
   * The jackpot (BP-41's dice) — E major, bright. Twelve quick square dings in thirty-seconds cycling E6 G#6 B6 G#6
   * (1.3–2.0 kHz) over a short riser; the drop at 0.70 s: kick, crash, a bright supersaw (E4 G#4 B4 E5) and a sub on E2;
   * a coin shimmer climbs E7 G#7 B7 E8 after it.
   */
  'moment.jackpot': {
    reverb: { seconds: 1.4, decay: 2.4, wet: 0.3, seed: 1701 },
    compose: (r) => {
      const ding = S16 / 2
      const drop = r.t0 + 12 * ding
      const cycle = [E6, G6s, B6, G6s]
      for (let i = 0; i < 12; i += 1) {
        bell(r, r.t0 + i * ding, cycle[i % cycle.length]!, { type: 'square', gain: 0.07, decay: 0.09, pan: i % 2 === 0 ? -0.25 : 0.25, send: 0.2 })
      }
      riser(r, drop - 0.4, 0.4, { seed: 1702, from: 1_000, to: 9_000, q: 1.2, gain: 0.2, send: 0.2 })
      kick(r, drop, { gain: 0.75, from: 150, to: 48, drop: 0.1, decay: 0.4, send: 0.08 })
      crash(r, drop, { seed: 1703, decay: 1.0, gain: 0.12, send: 0.3 })
      chord(r, drop, [E4, G4s, B4, E5], {
        detune: [-11, 0, 11],
        spread: 0.6,
        attack: 0.02,
        hold: r.end - 0.45,
        end: r.end,
        level: 0.26,
        cutoff: 5_200,
        cutoffFrom: 2_000,
        filterTime: 0.1,
        send: 0.35,
      })
      chord(r, drop + 0.05, [E2], { type: 'sine', attack: 0.1, hold: r.end - 0.45, end: r.end, level: 0.22, cutoff: 400 })
      ;[E7, G7s, B7, E8].forEach((note, i) => bell(r, drop + (i + 1) * S16, note, { gain: 0.04, decay: 0.4, pan: [-0.4, 0.4][i % 2], send: 0.45 }))
    },
  },
}
