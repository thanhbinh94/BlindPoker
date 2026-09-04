import { InsufficientBalanceError, type BalanceEntry, type HandSummary, type PlayerRecord, type Repositories, type SettlementMeta } from './repositories.js'

export interface MemoryRepositories extends Repositories {
  addPlayer(playerId: string, displayName: string, balance: number): PlayerRecord
  records: Map<string, PlayerRecord>
  hands: HandSummary[]
  entries: { entry: BalanceEntry; meta?: SettlementMeta }[]
  /** Every `apply` meta with `fee > 0`: the points that left player balances and went to no player. */
  sinks: SettlementMeta[]
}

export function createMemoryRepositories(): MemoryRepositories {
  const records = new Map<string, PlayerRecord>()
  const hands: HandSummary[] = []
  const entries: { entry: BalanceEntry; meta?: SettlementMeta }[] = []
  const sinks: SettlementMeta[] = []
  const must = (playerId: string): PlayerRecord => {
    const r = records.get(playerId)
    if (!r) throw new Error(`unknown player ${playerId}`)
    return r
  }
  return {
    records,
    hands,
    entries,
    sinks,
    addPlayer(playerId, displayName, balance) {
      const rec = { playerId, displayName, balance }
      records.set(playerId, rec)
      return rec
    },
    players: {
      async findById(playerId) {
        const r = records.get(playerId)
        return r ? { ...r } : null
      },
    },
    balances: {
      async get(playerId) {
        return must(playerId).balance
      },
      // Contract: net the deltas per player first, then check `balance + net >= 0` — a batch that
      // debits and re-credits the same player is judged on its net effect, not on intermediates.
      async apply(batch, meta) {
        const nets = new Map<string, number>()
        for (const e of batch) nets.set(e.playerId, (nets.get(e.playerId) ?? 0) + e.delta)
        const next = new Map<string, number>()
        for (const [playerId, net] of nets) {
          const after = must(playerId).balance + net
          if (after < 0) throw new InsufficientBalanceError(playerId)
          next.set(playerId, after)
        }
        for (const [playerId, balance] of next) must(playerId).balance = balance
        for (const entry of batch) entries.push(meta ? { entry, meta } : { entry })
        if (meta && meta.fee > 0) sinks.push(meta)
      },
    },
    history: {
      async recordHand(summary) {
        hands.push(structuredClone(summary))
      },
    },
  }
}
