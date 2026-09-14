import type { CSSProperties } from 'react'
import { AvatarAssets, Chibi, type BaseRef, type ChibiConfig, type Expression, type WearRef } from '../src/avatar2d/index.js'

/**
 * Every placeholder id T1 generated, hard-coded here rather than read from the manifest: this page exists to look
 * at the art stage 1 actually produced, so a fixture that silently grew or shrank with the manifest would defeat
 * the point. Keep this list in step with `apps/normal-web/public/avatar/avatar-manifest.json` by hand.
 */
const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']
const BASE_IDS = ['f01', 'm01'] as const
const HEAD_ITEMS = ['tophat01', 'dealer_visor01', 'beret_red01', 'crown_gold01', 'conical_hat01', 'beanie01', 'party_cone01', 'hood_black01']
const FACE_ITEMS = ['eyepatch01', 'glasses_round_gold01', 'masquerade01', 'sunglasses01']
const OUTFIT_ITEMS = ['casual01', 'champion01', 'dealer01', 'royal_robe01', 'tet_red01', 'tuxedo01']
const AURA_ITEMS = ['earth01', 'fire01', 'gold_cards01', 'ice01', 'lightning01', 'sakura01', 'water01', 'wind01']
const FRAME_ITEMS = ['bronze', 'founder', 'gold', 'monthly', 'silver', 'veteran']
const BOT_COUNT = 8

function base(id: (typeof BASE_IDS)[number]): BaseRef {
  const faces = {} as Record<Expression, string>
  for (const expression of EXPRESSIONS) faces[expression] = `base_${id}_face_${expression}_L50`
  return { id, hairBack: `base_${id}_L20`, body: `base_${id}_L30`, hairFront: `base_${id}_L60`, faces }
}

const BASES: Record<(typeof BASE_IDS)[number], BaseRef> = { f01: base('f01'), m01: base('m01') }
const CASUAL_OUTFIT: WearRef = { id: 'outfit_casual01', order: 40, file: 'item_outfit_casual01_L40' }

/** `item_<slot>_<code>_L<layer>` — T1's naming convention (spec §3). `hood_black01` is the one item stage 1 gave a
 * hide flag, so it is the one this page needs to get right. */
function wear(slot: string, code: string, order: number): WearRef {
  const hides = code === 'hood_black01' ? { hidesHairFront: true, hidesHairBack: true } : {}
  return { id: `${slot}_${code}`, order, file: `item_${slot}_${code}_L${order}`, ...hides }
}

const chibi = (baseId: (typeof BASE_IDS)[number], patch: Partial<ChibiConfig> = {}): ChibiConfig => ({
  kind: 'human',
  base: BASES[baseId],
  outfit: CASUAL_OUTFIT,
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
 * Every placeholder PNG layer T1 produced, on both bases: the six expressions, every wearable in every slot, the
 * eight bots, and the head crop at the three sizes the spec actually uses (192 profile, 40 seat, 32 lobby bar).
 * Reached at `#avatar2d` — see `main.tsx`.
 */
export function Avatar2dPage() {
  return (
    <AvatarAssets base="/avatar/">
      <div style={{ padding: '12px 20px 40px', maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>avatar2d placeholders</h1>

        <h2 style={heading}>Expressions</h2>
        {BASE_IDS.map((id) => (
          <div key={id} style={row}>
            {EXPRESSIONS.map((expression) => (
              <Cell key={expression} config={chibi(id)} expression={expression} caption={`${id} · ${expression}`} />
            ))}
          </div>
        ))}

        <h2 style={heading}>Outfit</h2>
        {BASE_IDS.map((id) => (
          <div key={id} style={row}>
            {OUTFIT_ITEMS.map((code) => (
              <Cell key={code} config={chibi(id, { outfit: wear('outfit', code, 40) })} caption={`${id} · ${code}`} />
            ))}
          </div>
        ))}

        <h2 style={heading}>Head</h2>
        {BASE_IDS.map((id) => (
          <div key={id} style={row}>
            {HEAD_ITEMS.map((code) => (
              <Cell key={code} config={chibi(id, { head: wear('head', code, 80) })} caption={`${id} · ${code}`} />
            ))}
          </div>
        ))}

        <h2 style={heading}>Face</h2>
        {BASE_IDS.map((id) => (
          <div key={id} style={row}>
            {FACE_ITEMS.map((code) => (
              <Cell key={code} config={chibi(id, { face: wear('face', code, 70) })} caption={`${id} · ${code}`} />
            ))}
          </div>
        ))}

        <h2 style={heading}>Aura</h2>
        {BASE_IDS.map((id) => (
          <div key={id} style={row}>
            {AURA_ITEMS.map((code) => (
              // `head` frame drops the aura layer (it would just bleed off the circular edge), so this row draws
              // `full` instead — the one place on this page a full-body box is the more honest preview.
              <div key={code} style={cell}>
                <Chibi subject={chibi(id, { aura: wear('aura', code, 10) })} frame="full" />
                <span style={label}>{`${id} · ${code}`}</span>
              </div>
            ))}
          </div>
        ))}

        <h2 style={heading}>Frame</h2>
        {BASE_IDS.map((id) => (
          <div key={id} style={row}>
            {FRAME_ITEMS.map((code) => (
              <Cell key={code} config={chibi(id, { frame: wear('frame', code, 90) })} caption={`${id} · ${code}`} />
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
              <Chibi subject={chibi('f01')} frame="head" size={size} />
              <span style={label}>{`${size}px`}</span>
            </div>
          ))}
        </div>
      </div>
    </AvatarAssets>
  )
}
