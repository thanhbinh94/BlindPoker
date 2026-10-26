import type { ChaosCardDef, ChaosConfig, ChaosCreditReason } from '@bp/core'

/**
 * What a chaos table (Poker hỗn loạn, spec 2026-10-26) needs from its edition: the cards active now, the settings, and a
 * ledgered way to pay the new points a card earns. Normal backs it with the database (Plan 37 Task 4); Lite has none, so
 * a server without a port refuses chaos tables (`CHAOS_UNAVAILABLE`).
 */
export interface ChaosPort {
  /** The cards active now, and the GM's draw weights (absent = 1, 0 = never). */
  catalogue(): Promise<{ cards: readonly ChaosCardDef[]; weights: ReadonlyMap<string, number> }>
  config(): Promise<ChaosConfig>
  /**
   * Pays `amount` new points to the player's table stack: a `reason` source row and a paired `chaos_to_table` transfer,
   * both under `key`, so the balance is untouched and the room adds `credited` to the stack. The daily cap (and the
   * daily Cấp cứu count) may cut it: `credited` is what was paid, `capped` says it was cut. A replayed key writes nothing
   * and returns the amount already written under it.
   */
  credit(c: { playerId: string; roomId: string; amount: number; reason: ChaosCreditReason; key: string }): Promise<{ credited: number; capped: boolean }>
}
