import { CHAOS_CARDS_SPEC, DEFAULT_CHAOS_CONFIG, type ChaosCardDef, type ChaosConfig } from '@bp/core'
import type { ChaosPort } from '../chaos-port.js'
import type { MemoryRepositories } from '../memory-repositories.js'

export interface MemoryChaosOptions {
  /** The catalogue; the spec's 47 cards by default. */
  cards?: readonly ChaosCardDef[]
  config?: Partial<ChaosConfig>
  weights?: ReadonlyMap<string, number>
  repos: MemoryRepositories
  /** New chaos points one player may receive in all (the memory port has no economy day); `config.dailyCapPoints` by default. */
  capPoints?: number
  /** Cấp cứu credits one player may receive in all; `config.dailyRescues` by default. */
  rescues?: number
  /** Test hook: throw from `catalogue()`/`config()` while true. */
  failReads?: () => boolean
  /** Test hook: throw from `credit()` before writing, while it returns true (called once per attempt). */
  failCredit?: () => boolean
  /** Test hook: write the credit, then throw as if the reply were lost, while it returns true (called once per attempt). */
  loseCreditReply?: () => boolean
}

/**
 * A `ChaosPort` over the memory repositories, for tests and the playground: credits are written through
 * `repos.balances.apply` as `[+credited reason, −credited chaos_to_table]` under the key, with `refId` = the key so a
 * replay can find the amount it wrote.
 */
export function createMemoryChaosPort(opts: MemoryChaosOptions): ChaosPort {
  const config: ChaosConfig = { ...DEFAULT_CHAOS_CONFIG, ...opts.config }
  const cards = opts.cards ?? CHAOS_CARDS_SPEC
  const weights = opts.weights ?? new Map<string, number>()
  const capPoints = opts.capPoints ?? config.dailyCapPoints
  const rescues = opts.rescues ?? config.dailyRescues
  const { repos } = opts
  const reads = async <T>(v: T): Promise<T> => {
    if (opts.failReads?.()) throw new Error('chaos port unavailable')
    return v
  }
  return {
    catalogue: () => reads({ cards, weights }),
    config: () => reads(config),
    async credit({ playerId, amount, reason, key }) {
      if (opts.failCredit?.()) throw new Error('chaos credit failed')
      const written = repos.entries.find((e) => e.entry.refId === key && e.entry.reason === reason)
      if (written) return { credited: written.entry.delta, capped: written.entry.delta < amount }
      const mine = repos.entries.filter((e) => e.entry.playerId === playerId)
      const paid = mine.filter((e) => e.entry.reason === 'chaos_rescue' || e.entry.reason === 'chaos_crit' || e.entry.reason === 'chaos_fortune').reduce((s, e) => s + e.entry.delta, 0)
      const rescued = mine.filter((e) => e.entry.reason === 'chaos_rescue').length
      const allowed = reason === 'chaos_rescue' && rescued >= rescues ? 0 : Math.max(0, capPoints - paid)
      const credited = Math.min(amount, allowed)
      if (credited > 0) {
        const r = await repos.balances.apply([
          { playerId, delta: credited, reason, refId: key },
          { playerId, delta: -credited, reason: 'chaos_to_table', refId: key },
        ], undefined, { key })
        if (!r.applied) {
          const again = repos.entries.find((e) => e.entry.refId === key && e.entry.reason === reason)
          return { credited: again?.entry.delta ?? 0, capped: (again?.entry.delta ?? 0) < amount }
        }
      }
      if (opts.loseCreditReply?.()) throw new Error('chaos credit reply lost')
      return { credited, capped: credited < amount }
    },
  }
}
