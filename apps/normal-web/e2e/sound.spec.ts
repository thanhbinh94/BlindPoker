import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { transformWithEsbuild } from 'vite'

/**
 * The seven stingers, measured in Chromium (BP-42, spec §5.2). The unit tests prove the engine's rules with a fake
 * audio context; only a browser can render the real Web Audio graph, so this file transpiles `stingers.ts` alone
 * (it has no runtime imports, by design), renders each stinger through `createMaster` in an `OfflineAudioContext`
 * and returns numbers only.
 *
 * It needs no server and registers nobody, though the config starts its web server anyway. With `BP_SOUND_WAV_DIR`
 * set it also writes each render as `<id>.wav` (16-bit stereo, 44.1 kHz) there, for a listener to audition.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const STINGERS_FILE = resolve(HERE, '../../../packages/ui-kit/src/sound/stingers.ts')

/** −60 dBFS: below this a sample is silence for the "last audible sample" measure. */
const AUDIBLE = 0.001
/** The numbers the page hands back for one stinger. */
interface Measure {
  id: string
  seconds: number
  peak: number
  lastAudible: number
  tailDb: number
  envelope: number[]
  wav: number[] | null
}

test('the seven stingers render in Chromium: right length, no clipping, a silent tail, all different', async ({ page }) => {
  const source = readFileSync(STINGERS_FILE, 'utf8')
  const { code } = await transformWithEsbuild(source, STINGERS_FILE, {
    loader: 'ts',
    format: 'iife',
    globalName: 'Stingers',
  })
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ content: code })

  const wavDir = process.env.BP_SOUND_WAV_DIR
  const measures = await page.evaluate(
    async ({ wantWav, audible }) => {
      const S = (window as unknown as {
        Stingers: {
          STINGER_IDS: readonly string[]
          STINGER_SECONDS: Record<string, number>
          createMaster: (ctx: BaseAudioContext) => AudioNode
          scheduleStinger: (ctx: BaseAudioContext, out: AudioNode, id: string, when: number) => number
        }
      }).Stingers
      const rate = 44100
      const result: Measure[] = []
      const at = (samples: Float32Array, i: number): number => samples[i] ?? 0
      for (const id of S.STINGER_IDS) {
        const seconds = S.STINGER_SECONDS[id] ?? 0
        const ctx = new OfflineAudioContext(2, Math.ceil(rate * (seconds + 0.5)), rate)
        S.scheduleStinger(ctx, S.createMaster(ctx), id, 0)
        const buf = await ctx.startRendering()
        const left = buf.getChannelData(0)
        const right = buf.getChannelData(1)
        let peak = 0
        let last = 0
        for (let i = 0; i < left.length; i++) {
          const a = Math.max(Math.abs(at(left, i)), Math.abs(at(right, i)))
          if (a > peak) peak = a
          if (a > audible) last = i
        }
        // Mean power of both channels over [from, to).
        const power = (from: number, to: number): number => {
          let sum = 0
          for (let i = from; i < to; i++) sum += (at(left, i) ** 2 + at(right, i) ** 2) / 2
          return sum / (to - from)
        }
        const end = Math.floor(seconds * rate)
        const tail = Math.sqrt(power(Math.floor((seconds - 0.15) * rate), end))
        const frame = Math.floor(0.05 * rate)
        const envelope: number[] = []
        for (let from = 0; from < end; from += frame) envelope.push(Math.sqrt(power(from, Math.min(from + frame, end))))
        let wav: number[] | null = null
        if (wantWav) {
          const n = buf.length
          const view = new DataView(new ArrayBuffer(44 + n * 4))
          const tag = (offset: number, text: string): void => {
            for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
          }
          tag(0, 'RIFF')
          view.setUint32(4, 36 + n * 4, true)
          tag(8, 'WAVEfmt ')
          view.setUint32(16, 16, true)
          view.setUint16(20, 1, true)
          view.setUint16(22, 2, true)
          view.setUint32(24, rate, true)
          view.setUint32(28, rate * 4, true)
          view.setUint16(32, 4, true)
          view.setUint16(34, 16, true)
          tag(36, 'data')
          view.setUint32(40, n * 4, true)
          for (let i = 0; i < n; i++) {
            view.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, at(left, i))) * 32767), true)
            view.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, at(right, i))) * 32767), true)
          }
          wav = Array.from(new Uint8Array(view.buffer))
        }
        result.push({
          id,
          seconds,
          peak,
          lastAudible: last / rate,
          tailDb: 20 * Math.log10(tail + 1e-12),
          envelope,
          wav,
        })
      }
      return result
    },
    { wantWav: Boolean(wavDir), audible: AUDIBLE },
  )

  expect(measures.map((m) => m.id)).toHaveLength(7)

  if (wavDir) {
    mkdirSync(wavDir, { recursive: true })
    for (const m of measures) if (m.wav) writeFileSync(join(wavDir, `${m.id}.wav`), Buffer.from(m.wav))
  }

  const table: string[] = []
  const at = (values: number[], i: number): number => values[i] ?? 0
  for (const m of measures) {
    table.push(
      `${m.id}: length ${m.seconds}s, last audible ${m.lastAudible.toFixed(3)}s, peak ${m.peak.toFixed(3)}, tail ${m.tailDb.toFixed(1)} dBFS`,
    )
    // Length: the last sample above −60 dBFS sits within ±10 % of the table length.
    expect(m.lastAudible, `${m.id} last audible`).toBeGreaterThan(m.seconds * 0.9)
    expect(m.lastAudible, `${m.id} last audible`).toBeLessThan(m.seconds * 1.1)
    // Peak: audible, and never at full scale.
    expect(m.peak, `${m.id} peak`).toBeGreaterThan(0.05)
    expect(m.peak, `${m.id} peak`).toBeLessThan(1)
    // Tail: the last 150 ms of the stinger's own length is below −50 dBFS RMS.
    expect(m.tailDb, `${m.id} tail`).toBeLessThan(-50)
  }

  // Distinct: the 50 ms RMS envelopes of every pair correlate (uncentred, over the shorter) below 0.95.
  const correlations: string[] = []
  measures.forEach((first, a) => {
    for (const second of measures.slice(a + 1)) {
      const n = Math.min(first.envelope.length, second.envelope.length)
      let xy = 0
      let xx = 0
      let yy = 0
      for (let i = 0; i < n; i++) {
        const x = at(first.envelope, i)
        const y = at(second.envelope, i)
        xy += x * y
        xx += x * x
        yy += y * y
      }
      const corr = xy / Math.sqrt(xx * yy)
      correlations.push(`${first.id} x ${second.id}: ${corr.toFixed(2)}`)
      expect(corr, `${first.id} x ${second.id}`).toBeLessThan(0.95)
    }
  })
  console.log(`${table.join('\n')}\n${correlations.join('\n')}`)
})
