/**
 * The Normal edition's `ChaosPort` (server-kit): what a Poker hỗn loạn room asks of its edition, answered by the chaos
 * service. The room reads `catalogue()` and `config()` once per draft, reads `config()` again after each hand for the
 * result's wait (`resultMs`, BP-39), and calls `credit()` for each card that pays; `createGameServer` refuses chaos tables
 * (`CHAOS_UNAVAILABLE`) when no port is given.
 */
import type { ChaosPort } from '@bp/server-kit'
import type { ChaosService } from './chaos-service.js'

export function createChaosPort(service: ChaosService): ChaosPort {
  return {
    catalogue: () => service.active(),
    config: () => service.config(),
    credit: (c) => service.credit(c),
  }
}
