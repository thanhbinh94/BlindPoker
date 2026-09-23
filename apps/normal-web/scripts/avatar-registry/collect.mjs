/**
 * `collect` (spec §4 step 3): the picture Claude just downloaded from ChatGPT goes into
 * assets/avatar-src/<asset.file>, and the registry records the attempt.
 *
 * The picture is either named outright (`--file`) or found: the newest `*.png` in the downloads folder
 * (Chrome's default, `%USERPROFILE%\Downloads`; ChatGPT names them `ChatGPT Image <date>, <time>.png`)
 * that is newer than the asset's last attempt — or, for a first attempt, no more than 30 minutes old. A
 * newest PNG older than that is refused rather than taken, because it can only be a picture already
 * collected for something else.
 */
import { copyFileSync, existsSync, readdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, parse } from 'node:path'
import { wantsPicture } from './queue.mjs'
import { MAX_ATTEMPTS, SRC_DIR, requireAsset } from './registry.mjs'

export const DEFAULT_DOWNLOADS = join(process.env.USERPROFILE ?? homedir(), 'Downloads')
/** How old a download may be when the asset has no earlier attempt to compare it with. */
export const FIRST_ATTEMPT_WINDOW_MS = 30 * 60 * 1000

/** The newest `*.png` directly inside `dir`, as `{ path, name, mtimeMs }`, or null. */
export function newestPng(dir) {
  let newest = null
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.png')) continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (!stat.isFile()) continue
    if (newest === null || stat.mtimeMs > newest.mtimeMs) newest = { path, name, mtimeMs: stat.mtimeMs }
  }
  return newest
}

/** Rename an existing `<name>.png` to the first free `<name>.prev<k>.png`, and return the new path. */
export function keepPrevious(file) {
  if (!existsSync(file)) return null
  const { dir, name, ext } = parse(file)
  let k = 1
  while (existsSync(join(dir, `${name}.prev${k}${ext}`))) k++
  const kept = join(dir, `${name}.prev${k}${ext}`)
  renameSync(file, kept)
  return kept
}

/**
 * Move a downloaded picture in for `id` and record it: attempt `{ n, at, chat, file, verdict: null }`,
 * status `generated`. Returns `{ from, to, kept, attempt }`.
 *
 * @param {any} registry
 * @param {string} id
 * @param {{ chat?: string | null, downloads?: string, file?: string | null, srcDir?: string, now?: number }} [options]
 */
export function collect(registry, id, { chat = null, downloads = DEFAULT_DOWNLOADS, file = null, srcDir = SRC_DIR, now = Date.now() } = {}) {
  const asset = requireAsset(registry, id)
  if (!wantsPicture(asset.status)) throw new Error(`asset ${id} is ${asset.status} — collect takes a picture only for todo, ng or rework-<n>`)
  if (asset.attempts.length >= MAX_ATTEMPTS) throw new Error(`asset ${id} has had its ${MAX_ATTEMPTS} attempts`)

  let from = file
  if (from === null) {
    if (!existsSync(downloads)) throw new Error(`no downloads folder at ${downloads}`)
    const newest = newestPng(downloads)
    if (newest === null) throw new Error(`no PNG in ${downloads}`)
    const last = [...asset.attempts].reverse().find((attempt) => attempt.at)
    const since = last ? Date.parse(last.at) : now - FIRST_ATTEMPT_WINDOW_MS
    if (newest.mtimeMs <= since) {
      const found = `the newest PNG in ${downloads} is ${newest.name} (modified ${new Date(newest.mtimeMs).toISOString()})`
      throw new Error(last ? `${found}, older than attempt ${last.n} (${last.at}) — download the new picture first` : `${found}, older than 30 minutes — download the new picture first, or name it with --file`)
    }
    from = newest.path
  } else if (!existsSync(from)) {
    throw new Error(`no file at ${from}`)
  }

  const to = join(srcDir, asset.file)
  const kept = keepPrevious(to)
  copyFileSync(from, to)
  const attempt = { n: asset.attempts.length + 1, at: new Date(now).toISOString(), chat, file: asset.file, verdict: null }
  asset.attempts.push(attempt)
  asset.status = 'generated'
  return { from, to, kept, attempt }
}
