/**
 * Prompts (spec §3): an asset's prompt is its kind's template — an item's is its slot's — with the
 * asset's `look` and reference filled in, plus one fix line per distinct reason an earlier attempt failed.
 *
 * A `null` prompt is rendered again on every read, so editing a template edits every prompt that has not
 * been overridden; a string prompt is a manual override and replaces the template (the fix lines still
 * follow it, since a retry after a failure should always say what went wrong).
 */
import { referenceOf } from './registry.mjs'

/**
 * The fixed table of fix lines, keyed by an attempt's `reason`. `style` is the user's taste: nothing a
 * prompt line can fix, so it adds none. A reason not in the table (`drift`, `heads`, `check:C6`, …) adds
 * none either.
 *
 * Plan 19 (v4, pre-flight #25) adds two the pipeline gives — `check:C12` (the body's head moved or changed
 * size) and `check:C13` (the hair's front lies over the eyes, or its split failed) — and three that only an
 * eye can give, recorded with `reject <id> --reason fingers|bald|pose` when a picture `verify` passed fails
 * the controller's own look.
 */
export const FIX_LINES = {
  redrawn: 'same image size, same hair, same clothing',
  tears: 'No tears',
  hair_colour: 'same hair colour',
  background: 'transparent background, no checkerboard',
  cropped: 'whole figure inside the image',
  strap: 'The tank top must be completely gone: no straps, no gray fabric anywhere',
  scope: 'Change nothing outside the requested area',
  'check:C12': 'Keep the face exactly the same size and in exactly the same place as in the input; only the body pose changes',
  'check:C13': 'The hair never covers the eyes; hair longer than the neck falls behind the shoulders',
  fingers: 'Each hand shows exactly five separate fingers: four fingers and a thumb',
  bald: 'The head is completely bald: no hair, no hairline, no stubble',
  pose: 'Relaxed pose: weight on one leg, arms hanging loosely away from the body',
  style: null,
}

/**
 * Where a kind needs another line for a reason than `FIX_LINES` gives (A2b review). A body or a hairstyle is
 * `redrawn` only when it comes back on another canvas than the 1024 × 1536 it was drawn on — a body is cut on
 * f01's transform, a hairstyle placed on its body — and the general line ("same hair, same clothing", against a
 * reference that has hair) would tell the model to keep hair on a body that has to be bald.
 */
export const KIND_FIX_LINES = {
  body: { redrawn: 'Output the exact same image size as the input, 1024 by 1536 pixels, with the face in exactly the same place and at exactly the same size as in the input' },
  hair: { redrawn: "Output the exact same image size as the input, 1024 by 1536 pixels, and keep the body's exact outline, width and height" },
}

/** Which template an asset uses: an item's slot, otherwise its kind. */
export const templateKey = (asset) => (asset.kind === 'item' ? asset.slot : asset.kind)

const PLACEHOLDER = /\{\{\s*([^}\s]+)\s*\}\}/g

/**
 * The fix lines an asset's failed attempts call for, once per distinct reason, in the order they first failed:
 * its kind's own line for a reason where `KIND_FIX_LINES` has one, otherwise `FIX_LINES`'.
 */
export function fixLines(asset) {
  const seen = new Set()
  const lines = []
  const own = KIND_FIX_LINES[asset.kind] ?? {}
  for (const attempt of asset.attempts ?? []) {
    if (attempt.verdict !== 'ng' || !attempt.reason || seen.has(attempt.reason)) continue
    seen.add(attempt.reason)
    const line = Object.hasOwn(own, attempt.reason) ? own[attempt.reason] : FIX_LINES[attempt.reason]
    if (line) lines.push(line)
  }
  return lines
}

/** The prompt to send for an asset's next attempt. Throws on a missing template or look key. */
export function renderPrompt(asset, registry) {
  let body
  if (typeof asset.prompt === 'string') {
    body = asset.prompt
  } else {
    const key = templateKey(asset)
    const template = registry.templates[key]
    if (typeof template !== 'string') throw new Error(`asset ${asset.id}: no template for ${key}`)
    body = template.replace(PLACEHOLDER, (_whole, name) => {
      if (name === 'ref') {
        const { file } = referenceOf(asset, registry)
        if (file === null) throw new Error(`asset ${asset.id}: the template uses {{ref}} but the asset has no reference`)
        return file
      }
      if (!name.startsWith('look.')) throw new Error(`asset ${asset.id}: unknown placeholder {{${name}}}`)
      const value = asset.look?.[name.slice('look.'.length)]
      if (typeof value !== 'string') throw new Error(`asset ${asset.id}: the template needs ${name}, which the look does not have`)
      return value
    })
  }
  return [body, ...fixLines(asset)].join('\n')
}
