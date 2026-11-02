import type { CSSProperties } from 'react'
import { AvatarAssets, Chibi, type ChibiConfig, type Gender } from '../src/avatar2d/index.js'
import { chibi, wear } from './avatar2d.js'

/** Plan 43: the three Thần sets, each worn whole (outfit, head, aura, frame), the full figure with its aura moving and
 * the head with its frame ring. Reached at `#thansets` (dev-only). */
const SETS = [
  { name: 'Thần Bài', outfit: 'card_god01', head: 'ace_crown01', aura: 'card_god01', frame: 'card_god' },
  { name: 'Bán Thần', outfit: 'demigod01', head: 'laurel_silver01', aura: 'demigod01', frame: 'demigod' },
  { name: 'Sát Thần', outfit: 'godslayer01', head: 'godslayer_helm01', aura: 'godslayer01', frame: 'godslayer' },
] as const

type SetSpec = (typeof SETS)[number]

function dressed(gender: Gender, set: SetSpec): ChibiConfig {
  // A male cut is a separate file (`..._m_L40`): the catalogue's `variants.m`.
  const outfit = wear('outfit', set.outfit, 40)
  return chibi(gender, {
    outfit: gender === 'm' ? { ...outfit, file: `item_outfit_${set.outfit}_m_L40` } : outfit,
    head: wear('head', set.head, 80),
    aura: wear('aura', set.aura, 10),
    frame: wear('frame', set.frame, 90),
  })
}

const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, alignItems: 'start' }
const label: CSSProperties = { fontSize: 12, color: 'var(--ink-muted)', textAlign: 'center', marginTop: 4 }
const heading: CSSProperties = { fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold)', margin: '20px 0 8px' }

export function ThanSetsPage() {
  return (
    <AvatarAssets base="/avatar/">
      <div data-than-sets style={{ padding: '12px 16px 40px', maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--ink)', fontSize: 20 }}>Thần sets</h1>
        {SETS.map((set) => (
          <section key={set.name} data-set={set.aura}>
            <h2 style={heading}>{set.name}</h2>
            <div style={grid}>
              {(['f', 'm'] as const).map((gender) => (
                <div key={`full-${gender}`}>
                  <Chibi subject={dressed(gender, set)} frame="full" />
                  <div style={label}>{`${gender} · full`}</div>
                </div>
              ))}
              {(['f', 'm'] as const).map((gender) => (
                <div key={`head-${gender}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Chibi subject={dressed(gender, set)} frame="head" size={120} />
                  <div style={{ ...label, marginTop: 24 }}>{`${gender} · head + frame`}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AvatarAssets>
  )
}
