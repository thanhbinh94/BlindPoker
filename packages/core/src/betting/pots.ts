export interface PotContributor {
  seat: number
  totalCommitted: number
  folded: boolean
}

export interface Pot {
  amount: number
  eligibleSeats: number[]
}

export interface PotResult extends Pot {
  winners: { seat: number; amount: number }[]
}

const sameSet = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Seats in clockwise order beginning with the first seat strictly after `afterSeat` (wrapping). */
export function clockwiseFrom(seatOrder: readonly number[], afterSeat: number): number[] {
  const sorted = [...seatOrder].sort((a, b) => a - b)
  const idx = sorted.findIndex((s) => s > afterSeat)
  if (idx < 0) return sorted
  return [...sorted.slice(idx), ...sorted.slice(0, idx)]
}

/** Layered main/side pots. Folded players' chips stay in the pots they reached. */
export function computePots(players: readonly PotContributor[]): Pot[] {
  const levels = [...new Set(players.filter((p) => p.totalCommitted > 0).map((p) => p.totalCommitted))].sort((a, b) => a - b)
  const unfolded = players.filter((p) => !p.folded).map((p) => p.seat).sort((a, b) => a - b)
  const pots: Pot[] = []
  let prev = 0
  for (const level of levels) {
    let amount = 0
    const eligible: number[] = []
    for (const p of players) {
      amount += Math.max(0, Math.min(p.totalCommitted, level) - Math.min(p.totalCommitted, prev))
      if (!p.folded && p.totalCommitted >= level) eligible.push(p.seat)
    }
    eligible.sort((a, b) => a - b)
    const elig = eligible.length > 0 ? eligible : unfolded
    if (amount > 0) {
      const last = pots[pots.length - 1]
      if (last && sameSet(last.eligibleSeats, elig)) last.amount += amount
      else pots.push({ amount, eligibleSeats: elig })
    }
    prev = level
  }
  return pots
}

/** Splits each pot among its best-ranked eligible seats; odd chips clockwise from the button. */
export function distributePots(
  pots: readonly Pot[],
  rankBySeat: ReadonlyMap<number, number>,
  seatOrder: readonly number[],
  button: number,
): PotResult[] {
  const order = clockwiseFrom(seatOrder, button)
  return pots.map((pot) => {
    const ranked = pot.eligibleSeats.filter((s) => rankBySeat.has(s))
    const winnersInOrder = ranked.length > 0
      ? (() => {
          const bestRank = Math.max(...ranked.map((s) => rankBySeat.get(s)!))
          return order.filter((s) => ranked.includes(s) && rankBySeat.get(s) === bestRank)
        })()
      : order.filter((s) => pot.eligibleSeats.includes(s))
    if (winnersInOrder.length === 0) throw new Error('distributePots: no eligible seats')
    const share = Math.floor(pot.amount / winnersInOrder.length)
    let remainder = pot.amount - share * winnersInOrder.length
    const winners = winnersInOrder.map((seat) => {
      const extra = remainder > 0 ? 1 : 0
      remainder -= extra
      return { seat, amount: share + extra }
    })
    return { amount: pot.amount, eligibleSeats: [...pot.eligibleSeats], winners }
  })
}

export function tableFee(totalPot: number, rate: number, cap?: number): number {
  const fee = Math.floor(totalPot * rate)
  return cap === undefined ? fee : Math.min(fee, cap)
}
