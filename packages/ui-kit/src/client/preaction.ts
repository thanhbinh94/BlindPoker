import type { LegalActions, PlayerAction } from '@bp/core'

/**
 * What a player may tick while it is not their turn.
 *
 * - `checkFold`: check if checking is free, otherwise fold.
 * - `callAny`: call whatever is in front of the seat when the turn comes, or check if nothing is.
 * - `fold`: fold when the turn comes — unless checking is free, in which case check: folding a hand nobody has bet
 *   into gives away a free card for nothing, and no poker client does it.
 */
export type PreActionKind = 'checkFold' | 'callAny' | 'fold'

/**
 * Turns a ticked pre-action into the one action to send now that `legal` has arrived, or `null` when nothing the
 * tick meant is legal — a `callAny` faced with a bet that only `allIn` can meet is the one case: an automatic
 * all-in is never what "call" meant, so the tick lapses and the tray asks the player.
 *
 * Pure and total over `legal.kinds`: the server's list is the only authority on what may be sent, and this never
 * invents a kind that list does not carry.
 */
export function resolvePreAction(kind: PreActionKind, legal: LegalActions): PlayerAction | null {
  const has = (k: PlayerAction['kind']): boolean => legal.kinds.includes(k)
  switch (kind) {
    case 'checkFold':
      return has('check') ? { kind: 'check' } : has('fold') ? { kind: 'fold' } : null
    case 'callAny':
      return has('call') ? { kind: 'call' } : has('check') ? { kind: 'check' } : null
    case 'fold':
      return has('check') ? { kind: 'check' } : has('fold') ? { kind: 'fold' } : null
  }
}
