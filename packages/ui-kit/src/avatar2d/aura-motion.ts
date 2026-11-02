/** The motion a Thần set's aura layer plays on a large chibi (Plan 43): the Thần Bài aura breathes, the Bán Thần aura
 * twinkles, the Sát Thần aura flickers. Keyed by the layer's file stem, the same `file` a `LayerRef` carries; any other
 * aura stays still. The CSS (`avatar2d.module.css`) animates opacity and brightness only, never position. */
export type AuraMotion = 'glow' | 'twinkle' | 'flicker'

export const AURA_MOTION: Readonly<Record<string, AuraMotion>> = {
  item_aura_card_god01_L10: 'glow',
  item_aura_demigod01_L10: 'twinkle',
  item_aura_godslayer01_L10: 'flicker',
}

/** The motion for this layer file, or `null` when it is not one of the three Thần auras. */
export function auraMotionOf(file: string): AuraMotion | null {
  return Object.hasOwn(AURA_MOTION, file) ? (AURA_MOTION[file] ?? null) : null
}
