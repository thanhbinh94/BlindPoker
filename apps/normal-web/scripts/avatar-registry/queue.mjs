/**
 * The queue (spec §3, §4 step 1, §6): which assets are ready to generate and in what order, the user's
 * `approve`/`reject` transitions, and the text `next` and `status` print.
 */
import { renderPrompt } from './prompts.mjs'
import { MAX_ATTEMPTS, SRC_DIR, isRework, pictureExists, referenceOf, referencePath, requireAsset } from './registry.mjs'

/**
 * The order `next` hands assets out in. Plan 12 (spec §4 step 1) put items on F01 first — head, face,
 * outfit — then the new bases, their expressions, auras, frames and bots. Plan 19 (v4) leads with what
 * everything else is drawn on: the bodies, then the hairstyles drawn on them, the outfits, the bodies' other
 * faces and the bots redrawn on body f, then the hats and glasses redrawn where they no longer fit. Every
 * Plan 12 asset is done or blocked by then, so the reorder moves nothing of theirs. Within a group the
 * registry's own order holds; `next --only` (Phase B's gate) picks assets out of it by id.
 */
export const PRIORITY = ['body', 'hair', 'item:outfit', 'bodyExpression', 'bot', 'item:head', 'item:face', 'base', 'expression', 'aura', 'frame']

export function priorityOf(asset) {
  const at = PRIORITY.indexOf(asset.kind === 'item' ? `item:${asset.slot}` : asset.kind)
  return at < 0 ? PRIORITY.length : at
}

/** Whether a status is one the loop may generate for: not yet tried, failed, or sent back. */
export const wantsPicture = (status) => status === 'todo' || status === 'ng' || isRework(status)

/**
 * Whether an asset can be generated now: its status wants a picture, it has attempts left, and its
 * reference resolves — a file that exists in `srcDir`, or an `@<id>` asset that is `ok` or `approved`.
 */
export function ready(asset, registry, { srcDir = SRC_DIR } = {}) {
  if (!wantsPicture(asset.status)) return false
  if (asset.attempts.length >= MAX_ATTEMPTS) return false
  const { file, asset: other } = referenceOf(asset, registry)
  if (other) return other.status === 'ok' || other.status === 'approved'
  return file === null || pictureExists(srcDir, file)
}

/**
 * The ready assets, in priority order, at most `limit` of them — or, with `only` (`next --only <id,…>`), only
 * those of the named ids that are ready, still in priority order. An `only` id the registry lacks throws.
 *
 * @param {any} registry
 * @param {{ limit?: number, srcDir?: string, only?: string[] | null }} [options]
 */
export function nextAssets(registry, { limit = Infinity, srcDir = SRC_DIR, only = null } = {}) {
  const named = only === null ? null : new Set(only.map((id) => requireAsset(registry, id).id))
  return registry.assets
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => (named === null || named.has(asset.id)) && ready(asset, registry, { srcDir }))
    .sort((a, b) => priorityOf(a.asset) - priorityOf(b.asset) || a.index - b.index)
    .slice(0, limit)
    .map(({ asset }) => asset)
}

/**
 * `ok → approved`, for the named ids or — with `'batch'` — every `ok` asset. Only the user approves (spec
 * §3). Returns the ids changed; throws on an unknown id or one that is not `ok`.
 */
export function approve(registry, ids) {
  const targets = ids === 'batch' ? registry.assets.filter((asset) => asset.status === 'ok') : ids.map((id) => requireAsset(registry, id))
  for (const asset of targets) if (asset.status !== 'ok') throw new Error(`asset ${asset.id} is ${asset.status}, not ok — only an ok picture can be approved`)
  for (const asset of targets) asset.status = 'approved'
  return targets.map((asset) => asset.id)
}

/**
 * The user's "<id> ng" (spec §3): the picture's last attempt is judged again — `verdict: 'ng'`, the reason
 * (`style` unless given), `by: 'user'` — without counting as a new attempt, and the asset goes to
 * `rework-<n>` (n = attempts so far) or, after the third, `blocked`. An ingested layer is marked not
 * ingested, so the picture that replaces it is ingested again.
 */
export function reject(registry, ids, { reason = 'style', at = new Date().toISOString() } = {}) {
  const targets = ids.map((id) => requireAsset(registry, id))
  for (const asset of targets) if (asset.attempts.length === 0) throw new Error(`asset ${asset.id} has no picture yet — nothing to reject`)
  for (const asset of targets) {
    const last = asset.attempts[asset.attempts.length - 1]
    Object.assign(last, { verdict: 'ng', reason, by: 'user', judgedAt: at })
    asset.status = asset.attempts.length >= MAX_ATTEMPTS ? 'blocked' : `rework-${asset.attempts.length}`
    if (asset.ingested) asset.ingested = false
  }
  return targets.map((asset) => asset.id)
}

/** How many assets are in each status, in the order statuses first appear. */
export function statusCounts(registry) {
  const counts = {}
  for (const asset of registry.assets) counts[asset.status] = (counts[asset.status] ?? 0) + 1
  return counts
}

/** `status`: the counts, then every blocked asset with the reasons its attempts failed for. */
export function formatStatus(registry) {
  const counts = statusCounts(registry)
  const width = Math.max(...Object.keys(counts).map((status) => status.length), 5)
  const lines = Object.entries(counts).map(([status, n]) => `${status.padEnd(width)}  ${n}`)
  lines.push(`${'total'.padEnd(width)}  ${registry.assets.length}`)
  const blocked = registry.assets.filter((asset) => asset.status === 'blocked')
  if (blocked.length) {
    lines.push('', 'blocked:')
    for (const asset of blocked) {
      const reasons = asset.attempts.map((attempt) => `${attempt.n}: ${attempt.reason ?? '?'}`).join(', ')
      lines.push(`  ${asset.id} — ${reasons}`)
    }
  }
  if (registry.meta?.pausedUntil) lines.push('', `paused until ${registry.meta.pausedUntil}`)
  return lines.join('\n')
}

/** One asset as `next` prints it, or as `--json` hands it over. */
export function describeNext(asset, registry, srcDir = SRC_DIR) {
  return {
    id: asset.id,
    file: asset.file,
    reference: referencePath(asset, registry, srcDir),
    attempt: asset.attempts.length + 1,
    prompt: renderPrompt(asset, registry),
  }
}

export function formatNext(assets, registry, srcDir = SRC_DIR) {
  if (assets.length === 0) return 'nothing is ready'
  return assets
    .map((asset) => {
      const entry = describeNext(asset, registry, srcDir)
      return [
        `## ${entry.id}`,
        `file       ${entry.file}`,
        `reference  ${entry.reference ?? 'none'}`,
        `attempt    ${entry.attempt}`,
        '',
        '```text',
        entry.prompt,
        '```',
      ].join('\n')
    })
    .join('\n\n')
}
