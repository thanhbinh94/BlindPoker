import type { CSSProperties } from 'react'
import {
  AvatarAssets,
  Chibi,
  DEFAULT_HAIR,
  DEFAULT_OUTFIT_FILE,
  hairRefOf,
  type BodyRef,
  type ChibiConfig,
  type Expression,
  type Gender,
  type WearRef,
} from '../src/avatar2d/index.js'

/**
 * Every layer id the pipeline produced, hard-coded here rather than read from the manifest: this page exists to look
 * at the art that is actually there, so a fixture that silently grew or shrank with the manifest would defeat the
 * point. Keep these lists in step with `apps/normal-web/public/avatar/avatar-manifest.json` by hand.
 *
 * Avatar v4 (Plan 19): a figure is a body per gender plus a two-layer hairstyle, so the first section is every body
 * × each of its gender's hairstyles × the six expressions. Until the art batches land these are the labelled
 * stand-ins, each carrying its own code on a plate.
 */
const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']
const GENDERS: readonly Gender[] = ['f', 'm']
const HAIR_STYLES: Record<Gender, readonly string[]> = {
  f: ['hair_f_bob01', 'hair_f_hime01', 'hair_f_wavy01', 'hair_f_ponytail01'],
  m: ['hair_m_tousled01', 'hair_m_neat01', 'hair_m_curly01', 'hair_m_spiky01'],
}
const HEAD_ITEMS = ['tophat01', 'dealer_visor01', 'beret_red01', 'crown_gold01', 'conical_hat01', 'beanie01', 'party_cone01', 'hood_black01']
const FACE_ITEMS = ['eyepatch01', 'glasses_round_gold01', 'masquerade01', 'sunglasses01']
const OUTFIT_ITEMS = ['casual01', 'champion01', 'dealer01', 'royal_robe01', 'tet_red01', 'tuxedo01']
const AURA_ITEMS = ['earth01', 'fire01', 'gold_cards01', 'ice01', 'lightning01', 'sakura01', 'water01', 'wind01']
const FRAME_ITEMS = ['bronze', 'founder', 'gold', 'monthly', 'silver', 'veteran']
const BOT_COUNT = 8

/** A body by the v4 naming rule: `body_<g>_L30` and `body_<g>_face_<expression>_L50`. */
function body(gender: Gender): BodyRef {
  const faces = {} as Record<Expression, string>
  for (const expression of EXPRESSIONS) faces[expression] = `body_${gender}_face_${expression}_L50`
  return { gender, body: `body_${gender}_L30`, faces }
}

const BODIES: Record<Gender, BodyRef> = { f: body('f'), m: body('m') }

/** The hats whose layer carries a hair clip (2026-10-06, the pipeline's `HAIR_CLIP`): the ones that cover the crown. */
const CLIPPING_HATS = ['beanie01', 'beret_red01', 'conical_hat01']

/** `item_<slot>_<code>_L<layer>` — the pipeline's naming convention. `hood_black01` is the one item drawn here with
 * both hide flags, so it is the one row that shows the hairstyle disappearing; `CLIPPING_HATS` clip it instead. */
function wear(slot: string, code: string, order: number): WearRef {
  const hides = code === 'hood_black01' ? { hidesHairFront: true, hidesHairBack: true } : {}
  const clips = slot === 'head' && CLIPPING_HATS.includes(code) ? { clipsHair: true } : {}
  return { id: `${slot}_${code}`, order, file: `item_${slot}_${code}_L${order}`, ...hides, ...clips }
}

/** A figure of `gender` in that gender's cut of the casual outfit, wearing `hair` (its default unless given). */
const chibi = (gender: Gender, patch: Partial<ChibiConfig> = {}, hair: string = DEFAULT_HAIR[gender]): ChibiConfig => ({
  kind: 'human',
  body: BODIES[gender],
  hair: hairRefOf(hair),
  outfit: { id: 'outfit_casual01', order: 40, file: DEFAULT_OUTFIT_FILE[gender] },
  ...patch,
})

const cell: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 108 }
const label: CSSProperties = { fontSize: 11, color: 'var(--ink-muted)', textAlign: 'center' }
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 20 }
const heading: CSSProperties = { fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold)', margin: '24px 0 8px' }

function Cell({ config, expression = 'neutral', size = 96, caption }: { config: ChibiConfig; expression?: Expression; size?: number; caption: string }) {
  return (
    <div style={cell}>
      <Chibi subject={config} expression={expression} frame="head" size={size} />
      <span style={label}>{caption}</span>
    </div>
  )
}

/**
 * Every PNG layer the pipeline produced, on both bodies: each body with each of its gender's hairstyles in all six
 * expressions, every wearable in every slot, the eight bots, and the head crop at the three sizes the spec actually
 * uses (192 profile, 40 seat, 32 lobby bar). Reached at `#avatar2d` — see `main.tsx`.
 */
export function Avatar2dPage() {
  return (
    <AvatarAssets base="/avatar/">
      <div style={{ padding: '12px 20px 40px', maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>avatar2d placeholders</h1>

        <h2 style={heading}>Bodies × hairstyles × expressions</h2>
        {GENDERS.flatMap((gender) =>
          HAIR_STYLES[gender].map((hair) => (
            <div key={hair} style={row}>
              {EXPRESSIONS.map((expression) => (
                <Cell key={expression} config={chibi(gender, {}, hair)} expression={expression} caption={`${hair} · ${expression}`} />
              ))}
            </div>
          )),
        )}

        <h2 style={heading}>Full body</h2>
        {GENDERS.map((gender) => (
          <div key={gender} style={row}>
            {HAIR_STYLES[gender].map((hair) => (
              <div key={hair} style={cell}>
                <Chibi subject={chibi(gender, {}, hair)} frame="full" />
                <span style={label}>{hair}</span>
              </div>
            ))}
          </div>
        ))}

        <h2 style={heading}>Outfit</h2>
        {GENDERS.map((gender) => (
          <div key={gender} style={row}>
            {OUTFIT_ITEMS.map((code) => (
              <Cell key={code} config={chibi(gender, { outfit: wear('outfit', code, 40) })} caption={`${gender} · ${code}`} />
            ))}
          </div>
        ))}

        <h2 style={heading}>Head × hairstyles</h2>
        {GENDERS.flatMap((gender) =>
          HAIR_STYLES[gender].map((hair) => (
            <div key={hair} style={row} data-hair-row={hair}>
              {HEAD_ITEMS.map((code) => (
                <Cell key={code} config={chibi(gender, { head: wear('head', code, 80) }, hair)} caption={`${hair.slice(5)} · ${code}`} />
              ))}
            </div>
          )),
        )}

        <h2 style={heading}>Face</h2>
        {GENDERS.map((gender) => (
          <div key={gender} style={row}>
            {FACE_ITEMS.map((code) => (
              <Cell key={code} config={chibi(gender, { face: wear('face', code, 70) })} caption={`${gender} · ${code}`} />
            ))}
          </div>
        ))}

        <h2 style={heading}>Aura</h2>
        {GENDERS.map((gender) => (
          <div key={gender} style={row}>
            {AURA_ITEMS.map((code) => (
              // `head` frame drops the aura layer (it would just bleed off the circular edge), so this row draws
              // `full` instead — the one place on this page a full-body box is the more honest preview.
              <div key={code} style={cell}>
                <Chibi subject={chibi(gender, { aura: wear('aura', code, 10) })} frame="full" />
                <span style={label}>{`${gender} · ${code}`}</span>
              </div>
            ))}
          </div>
        ))}

        <h2 style={heading}>Frame</h2>
        {GENDERS.map((gender) => (
          <div key={gender} style={row}>
            {FRAME_ITEMS.map((code) => (
              <Cell key={code} config={chibi(gender, { frame: wear('frame', code, 90) })} caption={`${gender} · ${code}`} />
            ))}
          </div>
        ))}

        <h2 style={heading}>Bots</h2>
        <div style={row}>
          {Array.from({ length: BOT_COUNT }, (_, index) => (
            <div key={index} style={cell}>
              <Chibi subject={{ kind: 'bot', index }} frame="head" size={96} />
              <span style={label}>{`bot ${index}`}</span>
            </div>
          ))}
        </div>

        <h2 style={heading}>Head crop sizes (profile 192 · seat 40 · lobby bar 32)</h2>
        <div style={{ ...row, alignItems: 'flex-end' }}>
          {[192, 40, 32].map((size) => (
            <div key={size} style={{ ...cell, width: 'auto' }}>
              <Chibi subject={chibi('f')} frame="head" size={size} />
              <span style={label}>{`${size}px`}</span>
            </div>
          ))}
        </div>
      </div>
    </AvatarAssets>
  )
}
