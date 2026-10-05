/**
 * The Normal edition's repositories, assembled.
 *
 * `server-kit` is handed this object as its `Repositories`; the extra members are what the edition's
 * own HTTP surface and economy services use. Composing here rather than exporting three factories
 * separately means there is one `createRepositories(db)` to construct in `main.ts` and one to stub in
 * a service test, and every service gets the same `db` handle — so `creditWithin` inside a caller's
 * transaction really is the same connection.
 */
import type { Repositories } from '@bp/server-kit'
import type { AppDb } from '../db/client.js'
import { createBalanceRepository, createLedgerReader, type LedgerReader, type NormalBalanceRepository } from './balance-repo.js'
import { createHistoryRepository, type NormalGameHistoryRepository } from './history-repo.js'
import { createPlayerRepository, type NormalPlayerRepository } from './player-repo.js'

export type { LedgerListOptions, LedgerReader, LedgerRow, LedgerSum, NormalBalanceRepository } from './balance-repo.js'
export { createBalanceRepository, createLedgerReader, creditWithin, pruneLedgerKeys, UnknownPlayerError } from './balance-repo.js'
export type { GameRow, NormalGameHistoryRepository } from './history-repo.js'
export { createHistoryRepository } from './history-repo.js'
export type { NormalPlayerRepository, PlayerRow } from './player-repo.js'
export { createPlayerRepository, DisplayNameTakenError } from './player-repo.js'
export { clampLimit, cursorOf, isUuid } from './util.js'

export interface NormalRepositories extends Repositories {
  db: AppDb
  players: NormalPlayerRepository
  balances: NormalBalanceRepository
  history: NormalGameHistoryRepository
  /** §12.5 monitoring and the player-facing points history. */
  ledger: LedgerReader
}

export function createRepositories(db: AppDb): NormalRepositories {
  return {
    db,
    players: createPlayerRepository(db),
    balances: createBalanceRepository(db),
    history: createHistoryRepository(db),
    ledger: createLedgerReader(db),
  }
}
