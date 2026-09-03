import { InsufficientBalanceError, type BalanceEntry, type HandSummary, type PlayerRecord, type Repositories, type SettlementMeta } from './repositories.js'

export interface MemoryRepositories extends Repositories {
  addPlayer(playerId: string, displayName: string, balance: number): PlayerRecord
  records: Map<string, PlayerRecord>
  hands: HandSummary[]
  entries: { entry: BalanceEntry; meta?: SettlementMeta }[]
}

export function createMemoryRepositories(): MemoryRepositories {
  const records = new Map<string, PlayerRecord>()
  const hands: HandSummary[] = []
  const entries: { entry: BalanceEntry; meta?: SettlementMeta }[] = []
  const must = (playerId: string): PlayerRecord => {
    const r = records.get(playerId)
    if (!r) throw new Error(`unknown player ${playerId}`)
    return r
  }
  return {
    records,
    hands,
    entries,
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
      async apply(batch, meta) {
        const next = new Map<string, number>()
        for (const e of batch) {
          const current = next.get(e.playerId) ?? must(e.playerId).balance
          const after = current + e.delta
          if (after < 0) throw new InsufficientBalanceError(e.playerId)
          next.set(e.playerId, after)
        }
        for (const [playerId, balance] of next) must(playerId).balance = balance
        for (const entry of batch) entries.push(meta ? { entry, meta } : { entry })
      },
    },
    history: {
      async recordHand(summary) {
        hands.push(structuredClone(summary))
      },
    },
  }
}
